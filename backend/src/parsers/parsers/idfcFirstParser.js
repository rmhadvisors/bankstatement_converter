import { clean, parseAmount, parseDate } from "./common.js";

// IDFC FIRST Bank "STATEMENT OF ACCOUNT": Transaction Date | Value Date | Particulars | Cheque No |
// Debit | Credit | Balance. Particulars wrap above AND below the date line, so rows are the
// vertical line clusters of each page, never continued across a page break.
const AMOUNT = /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}$/;
const DATE = /^\d{2}-[A-Za-z]{3}-\d{4}$/;
const COLUMN_HEADER = /\bValue Date\b.*\bParticulars\b.*\bDebit\b.*\bCredit\b.*\bBalance\b/i;
// ponytail: fixed gap threshold; lines inside a row are <= ~11pt apart, rows >= ~15pt. If another
// IDFC export uses a different font size, derive this from the median line spacing instead.
const ROW_GAP = 13;

function isIdfcFirstLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /IDFC FIRST BANK/i.test(text) && /\bIDFB0\d{6}\b/.test(text) && lines.some((line) => COLUMN_HEADER.test(clean(line.text || line)));
}

function extractPrintedTotals(lines) {
  const index = lines.findIndex((line) => /^Opening Balance Total Debit Total Credit Closing Balance$/i.test(clean(line.text || line)));
  const values = index >= 0 ? clean(lines[index + 1]?.text || "").split(" ").filter((value) => AMOUNT.test(value)) : [];
  if (values.length !== 4) return null;
  const [openingBalance, withdrawal, deposit, closingBalance] = values.map(parseAmount);
  return { source: "printed", openingBalance, withdrawal, deposit, closingBalance };
}

// Column x-boundaries: midpoints between neighbouring header words.
function columnBounds(line) {
  const at = (pattern) => line.items.find((item) => pattern.test(clean(item.text)))?.x;
  const [particulars, debit, credit, balance] = [/^Particulars$/i, /^Debit$/i, /^Credit$/i, /^Balance$/i].map(at);
  return { particulars, debit, credit, balance };
}

function parseIdfcFirstTransactions(lines) {
  const printedTotals = extractPrintedTotals(lines);
  const transactions = [];
  const pages = new Map();
  for (const line of lines) pages.set(line.pageNumber, [...(pages.get(line.pageNumber) || []), line]);

  for (const pageLines of pages.values()) {
    const headerIndex = pageLines.findIndex((line) => COLUMN_HEADER.test(clean(line.text)));
    if (headerIndex < 0) continue;
    const header = columnBounds(pageLines[headerIndex]);
    // The cheque number column sits between Particulars and Debit; its header word is on the line above.
    const chequeX = pageLines[headerIndex - 1]?.items.find((item) => /^Cheque$/i.test(clean(item.text)))?.x ?? (header.particulars + header.debit) / 2;
    const bounds = {
      cheque: chequeX - 15,
      debit: (chequeX + header.debit) / 2,
      credit: (header.debit + header.credit) / 2,
      balance: (header.credit + header.balance) / 2,
    };

    // Body: after the "Date | No" second header line, up to the footer.
    const body = [];
    for (const line of pageLines.slice(headerIndex + 1)) {
      const text = clean(line.text);
      if (/^(?:REGISTERED OFFICE|IMPORTANT MESSAGE|Page \d+ of \d+)/i.test(text)) break;
      if (/^Date(?: No)?$/i.test(text) || /^Opening Balance\b/i.test(text)) continue;
      body.push(line);
    }

    const clusters = [];
    for (const line of body) {
      const last = clusters.at(-1);
      if (last && Math.abs(last.at(-1).y - line.y) <= ROW_GAP) last.push(line);
      else clusters.push([line]);
    }

    // A dateless block (a particulars cell split by a large line gap) joins the next row on the
    // page, or the previous one when it is the page's last block.
    const hasDate = (cluster) => cluster.some((line) => line.items.some((item) => item.x < header.particulars - 40 && DATE.test(clean(item.text))));
    const rows = [];
    let pending = [];
    for (const cluster of clusters) {
      if (hasDate(cluster)) {
        rows.push([...pending, ...cluster]);
        pending = [];
      } else pending.push(...cluster);
    }
    if (pending.length && rows.length) rows.at(-1).push(...pending);

    for (const cluster of rows) {
      const items = cluster.flatMap((line) => line.items.map((item) => ({ ...item, text: clean(item.text) })));
      const date = items.find((item) => item.x < header.particulars - 40 && DATE.test(item.text));
      const column = (from, to) => items.filter((item) => item.x >= from && item.x < to && AMOUNT.test(item.text)).map((item) => parseAmount(item.text));
      const [withdrawal = null] = column(bounds.debit, bounds.credit);
      const [deposit = null] = column(bounds.credit, bounds.balance);
      const [balance = null] = column(bounds.balance, Infinity);
      if (balance === null || (withdrawal === null && deposit === null)) continue;
      transactions.push({
        sequence: transactions.length + 1,
        date: parseDate(date.text),
        particulars:
          clean(cluster.flatMap((line) => line.items.filter((item) => item.x >= header.particulars - 40 && item.x < bounds.cheque).map((item) => item.text)).join(" "))
            .replace(/\/ +/g, "/") || "TRANSACTION",
        chequeNo: items.find((item) => item.x >= bounds.cheque && item.x < bounds.debit && /^\d+$/.test(item.text))?.text ?? null,
        withdrawal,
        deposit,
        balance,
      });
    }
  }

  return { transactions, printedTotals };
}

export { isIdfcFirstLayout, parseIdfcFirstTransactions };
