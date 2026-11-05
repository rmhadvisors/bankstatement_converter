import { AMOUNT_NUMBER_SRC, DATE_SRC, clean, maskCardNumbers, parseCcDate } from "./ccCommon.js";

// Last resort for a card statement no issuer parser could read: read the table by its HEADER COLUMNS.
// Used only when a parser found zero rows. The result is never trusted on its own: ccConverter reconciles it with
// the printed summary and reports the headers it found, and a dated line that could not be read is listed, so a
// statement with dated rows and amounts never ends as a bare "No transactions could be read".

const COLUMN_NAMES = [
  ["balance", /\bbalance\b/i],
  ["type", /^(?:debit\s*\/\s*credit|dr\s*\/\s*cr|type)\b/i], // before "debit": "Debit/Credit" is the direction word column
  ["debit", /^(?:debit|withdrawals?|dr)\b/i],
  ["credit", /^(?:credit|deposits?|cr)\b/i],
  ["amount", /\bamount\b|\bcharge\b/i],
  ["date", /^(?:transaction\s+|txn\s+|posting\s+|trans\.?\s+)?date\b/i],
  ["description", /details|description|particulars|narration|merchant/i],
];
const columnName = (text) => COLUMN_NAMES.find(([, pattern]) => pattern.test(clean(text)))?.[0] ?? "other";

const DATED_ROW = new RegExp(String.raw`^(${DATE_SRC})\s+(.+)$`, "i");
// Looks like a dated row, whatever the date shape: "13.04.2026 ...", "Apr 13th ...".
const LOOSE_DATE = /^\d{1,2}[ ./-][A-Za-z0-9]{2,9}[ ./,'’-]+[A-Za-z0-9']{2,5}\b/;
const AMOUNT_ITEM = new RegExp(String.raw`^([-+])?(?:₹|Rs\.?|INR)?\s?([-+])?(${AMOUNT_NUMBER_SRC})(?:\s?(Cr|Dr)\.?)?$`, "i");
const WORD_ITEM = /^(?:debit|credit|dr|cr)$/i;
const END_OF_STATEMENT = /\*{2,}\s*end\s+of\s+(?:statement|transaction\s+summary)\s*\*{2,}/i;

const sortedItems = (line) => [...(line.items ?? [])].sort((a, b) => a.x - b.x);

// A header line: three or more cells with known column names, including a date and an amount-like column.
function headerOf(line) {
  const cells = sortedItems(line).map((item) => ({ x: item.x, text: clean(item.text), name: columnName(item.text) }));
  const names = new Set(cells.map((cell) => cell.name).filter((name) => name !== "other"));
  return names.has("date") && names.size >= 3 && ["amount", "debit", "credit"].some((n) => names.has(n)) ? cells : null;
}

const nearest = (cells, x, names) => cells.filter((cell) => names.includes(cell.name)).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0] ?? null;

// -> { rows, headers, candidates, problems }
//   rows: transactions in the shape genericCard.js produces; headers: the header cell texts of the first table header;
//   candidates: dated-looking lines that carry an amount; problems: why some of them could not be read.
function parseByHeaderColumns(allLines, { cardLast4 = null, cardHolder = null } = {}) {
  const end = allLines.findIndex((line) => END_OF_STATEMENT.test(clean(line.text ?? "")));
  const lines = end === -1 ? allLines : allLines.slice(0, end);
  const rows = [];
  const problems = [];
  let header = null;
  let headers = null;
  let candidates = 0;
  const unread = { date: [], amount: [], direction: [] };

  for (const line of lines) {
    const text = clean(line.text ?? "");
    const here = line.items?.length ? headerOf(line) : null;
    if (here) {
      header = here;
      headers ??= here.map((cell) => cell.text);
      continue;
    }
    if (!header || !text) continue;

    const dated = text.match(DATED_ROW);
    const looksDated = dated || LOOSE_DATE.test(text);
    const items = sortedItems(line);
    const amounts = items.map((item) => ({ item, match: clean(item.text).match(AMOUNT_ITEM) })).filter((a) => a.match);
    if (!looksDated || !amounts.length) continue;
    candidates += 1;

    const date = dated ? parseCcDate(dated[1]) : null;
    if (!date) {
      unread.date.push(text);
      continue;
    }

    // Which column does each amount sit in? Nearest header cell; a balance column's value is not the transaction amount.
    const placed = amounts.map((a) => ({ ...a, column: nearest(header, a.item.x, ["amount", "debit", "credit", "balance", "other"])?.name ?? "other" }));
    const own = placed.filter((a) => a.column !== "balance");
    const hasSplitColumns = header.some((cell) => cell.name === "debit") && header.some((cell) => cell.name === "credit");
    if (own.length !== 1) {
      unread.amount.push(text);
      continue;
    }
    const [{ item, match, column }] = own;

    const word = items.map((i) => clean(i.text)).filter((t) => WORD_ITEM.test(t));
    const suffix = match[4]?.toLowerCase();
    const sign = match[1] || match[2] || "";
    let type = null;
    if (hasSplitColumns && (column === "debit" || column === "credit")) type = column;
    else if (word.length === 1) type = /^(?:credit|cr)$/i.test(word[0]) ? "credit" : "debit";
    else if (suffix) type = suffix === "cr" ? "credit" : "debit";
    else if (sign) type = sign === "-" ? "credit" : "debit";
    if (!type) {
      unread.direction.push(text);
      continue;
    }

    // description: the cells after the date and before the amount, without the direction word
    const dateLength = dated[1].length;
    let used = 0;
    const description = clean(
      items
        .filter((i) => {
          if (i === item || WORD_ITEM.test(clean(i.text)) || AMOUNT_ITEM.test(clean(i.text))) return false;
          if (used < dateLength) {
            used += clean(i.text).length + 1;
            return false; // part of the date
          }
          return true;
        })
        .map((i) => i.text)
        .join(" "),
    );
    rows.push({
      date,
      postDate: null,
      description: maskCardNumbers(description),
      refNo: null,
      amount: Number(match[3].replace(/,/g, "")),
      type,
      balance: null,
      rewardPoints: null,
      emiEligible: false,
      details: null,
      cardLast4,
      cardHolder,
      page: line.pageNumber ?? null,
    });
  }

  const say = (n, what) => `${n} dated line${n === 1 ? "" : "s"} ${what}`;
  if (unread.date.length) problems.push(`${say(unread.date.length, "with a date shape this reader does not know")} (first: "${unread.date[0].slice(0, 60)}")`);
  if (unread.amount.length) problems.push(`${say(unread.amount.length, "without exactly one amount in a transaction column")} (first: "${unread.amount[0].slice(0, 60)}")`);
  if (unread.direction.length) problems.push(`${say(unread.direction.length, "whose Debit/Credit direction could not be told")} (first: "${unread.direction[0].slice(0, 60)}")`);
  return { rows, headers: headers ?? [], candidates, problems };
}

// Makes the outcome visible in the existing reconciliation fields (status, X-Reconciliation-Warning, the Summary sheet):
// a layout nobody recognised is never a plain OK. Passing keeps OK with a note; a failure or an unread line is not OK.
function applyFallbackNotes(reconciliation, fallback) {
  const headers = fallback.headers.join(", ") || "none found";
  const invite = "send this PDF to add it as a known layout";
  if (reconciliation.status === "OK" && !fallback.problems.length) {
    reconciliation.warnings.unshift(`Layout not recognised (headers found: ${headers}) - read by its header columns and verified by the printed totals only; ${invite}.`);
  } else if (reconciliation.status === "OK") {
    reconciliation.status = "UNVERIFIED";
    reconciliation.warnings.unshift(`Layout not recognised (headers found: ${headers}); the totals match, but ${fallback.problems.join("; ")}. Some transactions may be missing; ${invite}.`);
  } else {
    reconciliation.warnings.unshift(`Layout not recognised (headers found: ${headers}) and the result does not reconcile - see the checks below${fallback.problems.length ? `; also ${fallback.problems.join("; ")}` : ""}; ${invite}.`);
  }
}

export { applyFallbackNotes, parseByHeaderColumns };
