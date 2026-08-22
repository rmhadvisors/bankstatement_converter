import { clean, roundMoney } from "./common.js";

// Handles OCR'd (scanned) SBI "STATEMENT OF ACCOUNT" exports, as distinct from the
// born-digital single-line-per-row layout `sbiParser.js` targets. These statements are
// printed 2-up (two logical statement pages side by side on one physical sheet, except
// the cover sheet which has only one table), so each physical OCR page must be split
// into a left and right column stream and read left-then-right to stay chronological.
const DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;
const HEADER_LABELS = ["Post", "Value", "Description", "Cheque", "Debit", "Credit", "Balance"];
const SIDE_SPLIT_X = 1770;

function isNoiseLine(text) {
  return (
    !text ||
    /^SBI$/i.test(text) ||
    /^STATE BANK OF INDIA$/i.test(text) ||
    /^STATEMENT OF ACCOUNT$/i.test(text) ||
    /^Page no\./i.test(text) ||
    /^(Post|Value) Date$/i.test(text) ||
    /^(Description|Cheque|Debit|Credit|Balance|No\/Reference)$/i.test(text)
  );
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isSbiOcrLayout(lines) {
  const hasItems = lines.some((line) => Array.isArray(line.items) && line.items.length > 0);
  if (!hasItems) return false;

  const text = lines
    .slice(0, 60)
    .map((line) => clean(line.text || line))
    .join("\n");

  const hasBranding = /state bank of india/i.test(text) && /statement of account/i.test(text);
  const hasColumns =
    /\bPost Date\b/i.test(text) &&
    /\bValue Date\b/i.test(text) &&
    /\bDescription\b/i.test(text) &&
    /\bDebit\b/i.test(text) &&
    /\bCredit\b/i.test(text) &&
    /\bBalance\b/i.test(text);
  const hasDashDates = lines.some((line) => DATE_PATTERN.test(clean(line.text || line)));

  return hasBranding && hasColumns && hasDashDates;
}

// OCR sometimes reads a comma-thousands-separator as a period (e.g. "5.000.00" for
// "5,000.00"). Treat every "." except the last as a thousands separator, same as ",".
function normalizeAmountText(raw) {
  let text = clean(raw).replace(/CR$/i, "").replace(/,/g, "");
  const parts = text.split(".");
  if (parts.length > 2) {
    const fraction = parts.pop();
    text = parts.join("") + "." + fraction;
  }
  return text;
}

function parseAmountLoose(raw) {
  const text = normalizeAmountText(raw);
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const AMOUNT_PATTERN = /^\d[\d,.]*\.\d{2}(CR)?$/i;

// Only trust a header word when it is the ENTIRE line's text (an isolated column
// header), not merely a substring match anywhere ("Cleared Balance" / "Monthly Avg
// Balance" in the account-summary sidebar also contain the word "Balance" and would
// otherwise badly skew the detected column position).
const EXACT_HEADER_LINE = {
  post: /^post( date)?$/i,
  value: /^value( date)?$/i,
  description: /^description$/i,
  cheque: /^cheque$/i,
  debit: /^debit$/i,
  credit: /^credit$/i,
  balance: /^balance$/i,
};

function detectHeaderColumns(lines) {
  const found = {};
  for (const label of HEADER_LABELS) {
    const key = label.toLowerCase();
    const pattern = EXACT_HEADER_LINE[key];
    const xs = [];
    for (const entry of lines) {
      const lineText = clean(entry.text || entry);
      if (!pattern.test(lineText)) continue;
      for (const item of entry.items || []) {
        if (clean(item.text).toLowerCase() === key) xs.push(item.x);
      }
    }
    found[key] = median(xs);
  }
  return found;
}

function buildLayout(lines) {
  const header = detectHeaderColumns(lines);
  return {
    postDateX: header.post ?? null,
    valueDateX: header.value ?? null,
    descriptionStart: header.description ?? null,
    descriptionEnd: (header.cheque ?? null) !== null ? header.cheque - 40 : null,
    chequeX: header.cheque ?? null,
    debitX: header.debit ?? null,
    creditX: header.credit ?? null,
    balanceX: header.balance ?? null,
  };
}

function nearestAmountColumn(x, layout) {
  const columns = [
    ["debit", layout.debitX],
    ["credit", layout.creditX],
    ["balance", layout.balanceX],
  ].filter(([, position]) => position !== null && position !== undefined);
  columns.sort((a, b) => Math.abs(x - a[1]) - Math.abs(x - b[1]));
  return columns[0]?.[0] ?? "balance";
}

function toDate(match) {
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

function extractDateAt(entry, columnX, tolerance = 60) {
  if (columnX === null) return null;
  const text = clean(entry.text || entry);
  const match = text.match(DATE_PATTERN);
  if (!match) return null;
  const x = (entry.items || [])[0]?.x;
  if (!Number.isFinite(x) || Math.abs(x - columnX) > tolerance) return null;
  return toDate(match);
}

function isAnchorLine(entry, layout) {
  const text = clean(entry.text || entry);
  if (!DATE_PATTERN.test(text)) return false;
  const x = (entry.items || [])[0]?.x;
  return Number.isFinite(x) && layout.postDateX !== null && Math.abs(x - layout.postDateX) <= 60;
}

// Parse one contiguous stream of lines (a single side of a single physical page,
// or a run of pages already filtered to one side) that share one consistent column layout.
function parseStream(lines) {
  if (lines.length === 0) return [];
  const layout = buildLayout(lines);
  if (layout.postDateX === null) return [];

  const rows = [];
  let current = null;
  let pendingDescription = [];

  let openingSeen = false;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text || isNoiseLine(text)) continue;

    if (!openingSeen && /^brought forward$/i.test(text)) {
      current = {
        postDate: null,
        valueDate: null,
        particularsParts: ["BROUGHT FORWARD"],
        chequeNo: null,
        debit: null,
        credit: null,
        balance: null,
        isOpeningBalance: true,
        pageNumber: entry.pageNumber,
      };
      pendingDescription = [];
      rows.push(current);
      openingSeen = true;
      continue;
    }

    if (isAnchorLine(entry, layout)) {
      current = {
        postDate: extractDateAt(entry, layout.postDateX),
        valueDate: null,
        particularsParts: [...pendingDescription],
        chequeNo: null,
        debit: null,
        credit: null,
        balance: null,
        pageNumber: entry.pageNumber,
      };
      pendingDescription = [];
      rows.push(current);
      continue;
    }

    const valDate = extractDateAt(entry, layout.valueDateX);
    if (valDate) {
      if (current) current.valueDate = valDate;
      continue;
    }

    const amountItems = (entry.items || [])
      .filter((item) => AMOUNT_PATTERN.test(clean(item.text)))
      .map((item) => ({ x: item.x, value: parseAmountLoose(item.text) }))
      .filter((item) => item.value !== null);

    if (amountItems.length > 0) {
      if (current) {
        for (const amount of amountItems) {
          const column = nearestAmountColumn(amount.x, layout);
          if (column === "debit") current.debit = amount.value;
          else if (column === "credit") current.credit = amount.value;
          else current.balance = amount.value;
        }
      }
      continue;
    }

    const chequeItem = (entry.items || []).find(
      (item) => layout.chequeX !== null && Math.abs(item.x - layout.chequeX) <= 80,
    );
    if (chequeItem && /^\d+$/.test(clean(chequeItem.text))) {
      if (current) current.chequeNo = clean(chequeItem.text);
      continue;
    }

    const x = (entry.items || [])[0]?.x;
    if (Number.isFinite(x) && layout.descriptionStart !== null && x >= layout.descriptionStart - 60) {
      if (current) current.particularsParts.push(text);
      else pendingDescription.push(text);
    }
  }

  return rows.map((row) => ({
    date: row.postDate,
    valueDate: row.valueDate,
    particulars: clean(row.particularsParts.join(" ")) || "TRANSACTION",
    chequeNo: row.chequeNo,
    withdrawal: row.debit,
    deposit: row.credit,
    balance: row.balance,
    isOpeningBalance: !!row.isOpeningBalance,
    pageNumber: row.pageNumber,
  }));
}

function parseSbiOcrTransactions(lines) {
  const byPage = new Map();
  for (const line of lines) {
    if (!byPage.has(line.pageNumber)) byPage.set(line.pageNumber, []);
    byPage.get(line.pageNumber).push(line);
  }

  const pageNumbers = [...byPage.keys()].sort((a, b) => a - b);
  const transactions = [];

  for (const pageNumber of pageNumbers) {
    const pageLines = byPage.get(pageNumber);
    const left = pageLines.filter((line) => {
      const x = (line.items || [])[0]?.x;
      return Number.isFinite(x) && x < SIDE_SPLIT_X;
    });
    const right = pageLines.filter((line) => {
      const x = (line.items || [])[0]?.x;
      return !Number.isFinite(x) || x >= SIDE_SPLIT_X;
    });

    transactions.push(...parseStream(left));
    transactions.push(...parseStream(right));
  }

  transactions.forEach((row, index) => {
    row.sequence = index + 1;
  });

  const openingBalance =
    transactions.length > 0 && transactions[0].balance !== null
      ? roundMoney(
          transactions[0].balance + Number(transactions[0].withdrawal || 0) - Number(transactions[0].deposit || 0),
        )
      : null;

  return { transactions, printedTotals: null, openingBalance };
}

export { isSbiOcrLayout, parseSbiOcrTransactions };
