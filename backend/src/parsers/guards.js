// Layout guards: small pure helpers that stop a statement layout from producing wrong rows silently.
// They hold no layout knowledge of their own; the parsers and validation call them (see the rule numbers).
//   1. column-driven amounts       -> columnBands, columnOfItem, inAmountColumns, isAmountText
//   3. page furniture               -> stripPageFurniture
//   5. aggregated review lines      -> groupRows, describeGroup
//   6. sanity bounds                -> findInsaneAmounts, isSaneAmount
//   4. description joining (layouts) -> joinWrappedLines, normalizeDescription

const round2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const fmt = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (text) => String(text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

// ---- rule 1: amounts come from the Debit / Credit / Balance columns only ----

// digits with optional thousands commas, exactly two decimals; ".80" (no leading zero) is an amount.
// A 12-digit reference or a cheque number has no decimals, so it can never match.
const AMOUNT_TEXT = /^-?(?:\d{1,3}(?:,\d{2,3})+|\d*)\.\d{2}(?:\s?(?:Cr|Dr)\.?)?$/i;
const isAmountText = (text) => AMOUNT_TEXT.test(clean(text));

const COLUMN_NAMES = {
  debit: /^(debit|withdrawals?|dr)\b/i,
  credit: /^(credit|deposits?|cr)\b/i,
  balance: /^(closing\s+)?balance\b/i,
  reference: /^(reference|ref\b|chq|cheque|instrument|inst\b)/i,
  valueDate: /^value\b/i,
  description: /^(description|narration|particulars|remarks)/i,
  date: /^(transaction|tran\b|txn|date)/i,
};
const AMOUNT_COLUMNS = new Set(["debit", "credit", "balance"]);

// headerItems: [{ x, text, width? }] of one header line -> [{ name, x, right }] (right only when widths are known).
// A header cell that matches no known name is kept as "other" so a nearby number is not taken by a neighbour.
function columnBands(headerItems) {
  return headerItems.map((item) => {
    const text = clean(item.text);
    const name = Object.entries(COLUMN_NAMES).find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
    return { name, x: item.x, right: Number.isFinite(item.width) && item.width > 0 ? item.x + item.width : null };
  });
}

// The column an item belongs to: nearest header by left edge, or by right edge for right-aligned numbers
// (when both widths are known). null when no header is close enough to claim it.
function columnOfItem(item, bands, tolerance = 70) {
  const right = Number.isFinite(item.width) && item.width > 0 ? item.x + item.width : null;
  let best = null;
  for (const band of bands) {
    const distances = [Math.abs(item.x - band.x)];
    if (right !== null && band.right !== null) distances.push(Math.abs(right - band.right));
    const distance = Math.min(...distances);
    if (distance <= tolerance && (best === null || distance < best.distance)) best = { name: band.name, distance };
  }
  return best?.name ?? null;
}

// True only for an amount-shaped number that sits in the Debit, Credit or Balance column.
const inAmountColumns = (item, bands) => isAmountText(item.text) && AMOUNT_COLUMNS.has(columnOfItem(item, bands));

// ---- rule 6: sanity bounds ----

const integerDigits = (value) => String(Math.floor(Math.abs(value))).length;

// kind: "balance" | "movement" (a debit or credit). maxBalance: the largest sane |balance| printed in the statement.
function isSaneAmount(value, { kind = "movement", maxBalance = null } = {}) {
  if (!Number.isFinite(value)) return { ok: false, reason: "is not a number" };
  if (integerDigits(value) > 11) return { ok: false, reason: "has more than 11 digits before the decimal point" };
  if (kind === "movement" && maxBalance !== null && maxBalance > 0 && Math.abs(value) > maxBalance * 100) {
    return { ok: false, reason: `is larger than 100 times the largest balance (${fmt(maxBalance)})` };
  }
  return { ok: true };
}

// rows: [{ withdrawal, deposit, balance }] in statement order -> [{ row (1-based), field, value, reason }]
function findInsaneAmounts(rows) {
  const balances = rows.map((row) => row.balance).filter((value) => Number.isFinite(value) && isSaneAmount(value, { kind: "balance" }).ok);
  const maxBalance = balances.length ? Math.max(...balances.map(Math.abs)) : null;
  const found = [];
  rows.forEach((row, index) => {
    for (const [field, kind] of [["withdrawal", "movement"], ["deposit", "movement"], ["balance", "balance"]]) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      const verdict = isSaneAmount(value, { kind, maxBalance });
      if (!verdict.ok) found.push({ row: index + 1, field, value, reason: verdict.reason });
    }
  });
  return found;
}

// ---- rule 3: repeated page furniture ----
//
// Furniture is only ever (a) the header block of a page, (b) lines left of the description column at the
// bottom of a page (page number, print timestamp, bank notices) and (c) the summary box. Wrapped description
// lines and the first row of every page look alike from page to page, so repetition alone is never enough:
// a line is only removed when it is NOT data-like (no leading date, no amount-shaped number) and either sits
// above the column-header line, or lies outside the table body by position.

// Digits -> "#", so "Page 3 of 26" and "03 Nov 2026, 18:54" repeat as one pattern on every page.
const shape = (text) => clean(text).replace(/\d/g, "#").toLowerCase();
const DATE_START = /^\d{1,2}[\s/.-](?:\d{1,2}|[A-Za-z]{3})[\s/.-]\d{2,4}\b/;
const isDataLike = (line) => DATE_START.test(clean(line.text)) || clean(line.text).split(" ").some(isAmountText);
const firstX = (line) => (line.items?.length ? Math.min(...line.items.map((item) => item.x)) : null);
const isColumnHeader = (line) => new Set((line.items ?? []).map((item) => columnBands([item])[0].name).filter((name) => name !== "other")).size >= 3;

// pages: [[{ text, items? }]]; bands: columnBands() of the header (gives the description column's left edge).
// -> { lines, furniture: [removed], summary: [from the summary box to the end] }
function stripPageFurniture(pages, { bands = [], summaryStart = /^(account summary|statement summary)\b/i } = {}) {
  const bodyLeft = (bands.find((band) => band.name === "description")?.x ?? null);
  // Without a description column to measure against, nothing counts as outside the body (nothing is peeled).
  const outside = (line) => bodyLeft !== null && firstX(line) !== null && firstX(line) < bodyLeft - 10;
  const repeats = new Map();
  for (const page of pages) for (const key of new Set(page.map((line) => shape(line.text)))) repeats.set(key, (repeats.get(key) ?? 0) + 1);
  const common = (line) => pages.length >= 3 && (repeats.get(shape(line.text)) ?? 0) >= Math.max(3, Math.ceil(pages.length * 0.6));

  const lines = [];
  const furniture = [];
  const summary = [];
  let inSummary = false;
  for (const page of pages) {
    const kept = new Array(page.length).fill(true);
    const header = page.findIndex(isColumnHeader);
    const firstData = page.findIndex(isDataLike);
    // (a) everything up to the column header and the label lines right under it ("Date"); with no column header
    // on this page, the leading lines before the first dated row, when they repeat from page to page.
    if (header >= 0) {
      let end = header;
      while (end + 1 < page.length && !isDataLike(page[end + 1]) && outside(page[end + 1])) end += 1;
      for (let i = 0; i <= end; i += 1) kept[i] = false;
    } else if (firstData > 0) {
      for (let i = 0; i < firstData; i += 1) if (common(page[i])) kept[i] = false;
    }
    // (b) trailing lines after the last row: peeled from the bottom while they repeat and lie outside the body.
    const lastData = page.map(isDataLike).lastIndexOf(true);
    for (let i = page.length - 1; i > lastData; i -= 1) {
      if (inSummary || summaryStart.test(clean(page[i].text))) break;
      if (common(page[i]) && outside(page[i]) && !isDataLike(page[i])) kept[i] = false;
      else break;
    }
    page.forEach((line, i) => {
      if (!inSummary && summaryStart.test(clean(line.text))) inSummary = true; // (c)
      if (!kept[i]) furniture.push(line);
      else if (inSummary) summary.push(line);
      else lines.push(line);
    });
  }
  return { lines, furniture, summary };
}

// ---- rule 5: one review line per kind of problem ----

// items: [{ row (1-based), amount }] -> { count, firstRow, sum }
function groupRows(items) {
  return { count: items.length, firstRow: Math.min(...items.map((item) => item.row)), sum: round2(items.reduce((total, item) => total + Math.abs(item.amount ?? 0), 0)) };
}

// "23 rows: debit read from reference number column (first: row 1; amounts affected 2,76,40,45,69,320.00)"
function describeGroup(what, items) {
  const { count, firstRow, sum } = groupRows(items);
  return `${count} row${count === 1 ? "" : "s"}: ${what} (first: row ${firstRow}; amounts affected ${fmt(sum)})`;
}

// ---- rule 4 (descriptions) ----

// Wrapped description lines: no space after a line that ends in "/", otherwise one space.
const joinWrappedLines = (lines) => lines.map(clean).filter(Boolean).reduce((text, line) => (text === "" ? line : text.endsWith("/") ? text + line : `${text} ${line}`), "");

// For comparing descriptions: whitespace around "/" does not matter ("TEST PAYER /" equals "TEST PAYER/").
const normalizeDescription = (text) => clean(text).replace(/\s*\/\s*/g, "/");

export {
  columnBands,
  columnOfItem,
  describeGroup,
  findInsaneAmounts,
  groupRows,
  inAmountColumns,
  isAmountText,
  isSaneAmount,
  joinWrappedLines,
  normalizeDescription,
  stripPageFurniture,
};
