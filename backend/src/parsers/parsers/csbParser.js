import { clean, parseAmount, roundMoney } from "./common.js";

// CSB Bank "Statement Of Account (in INR)" PDF with a text layer. Columns:
//   TRANS DATE | VALUE DATE | DETAILS | REF NO./CHEQUE NO. | DEBITS | CREDITS | BALANCE
// - The dates wrap inside their narrow cells: "15-APR-" on the row's line and "2025" on the line below, so the year
//   is read from the first line under the row that starts with one.
// - Every row prints BOTH a debit and a credit ("0.00" in the unused one), then the balance: the three amounts in
//   order. Exactly one of debit/credit is non-zero; anything else is reported and left out, never guessed.
// - The first row "B/F ..." is the balance brought forward, not a transaction: it gives the opening balance.
// - Details wrap below the row (a hard break after "-" or "|" is rejoined without a space). Page headers and
//   footers sit outside the details column or are recognised notices; "END OF STATEMENT" ends the table.
// - The box above the table prints Opening Balance | Total Debit | Total Credit | Closing Balance (no B/F in the credits).

const ROW_START = /^(\d{2})-([A-Za-z]{3})-$/;
const YEAR = /^\d{4}$/;
const AMOUNT = /^(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}$/;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DATE_X = 60; // text left of this is the date cell
const DETAILS_X = [100, 240];
const REFERENCE_X = [240, 300];
const AMOUNTS_X = 300; // debit, credit and balance all start right of this

function isCsbLayout(lines) {
  const head = lines.slice(0, 120).map((line) => clean(line.text || line));
  return head.some((text) => /^TRANS\s+VALUE\s+DETAILS\s+REF NO\.\s+DEBITS\s+CREDITS\s+BALANCE/i.test(text)) && head.some((text) => /\bCSB\b/i.test(text));
}

function sorted(entry) {
  return [...(entry.items || [])].sort((left, right) => left.x - right.x);
}

function rowStart(entry) {
  const items = sorted(entry);
  const match = items[0] && items[0].x < DATE_X ? clean(items[0].text).match(ROW_START) : null;
  if (!match) return null;
  const amounts = items.filter((item) => item.x >= AMOUNTS_X && AMOUNT.test(clean(item.text))).map((item) => roundMoney(parseAmount(item.text)));
  return {
    day: Number(match[1]),
    month: MONTHS[match[2].toLowerCase()],
    amounts,
    parts: items.filter((item) => item.x >= DETAILS_X[0] && item.x < DETAILS_X[1]).map((item) => clean(item.text)),
    reference: items.find((item) => item.x >= REFERENCE_X[0] && item.x < REFERENCE_X[1] && clean(item.text)),
  };
}

function joinParts(parts) {
  return clean(parts.reduce((text, part) => (!text ? part : /[-|]$/.test(text) ? text + part : `${text} ${part}`), ""));
}

// "Opening Balance | Total Debit Amount | Total Credit Amount | Closing Balance" and the line of four values under it.
function parseTotalsBox(lines) {
  const at = lines.findIndex((line) => /^Opening Balance\s+Total Debit Amount\s+Total Credit Amount\s+Closing Balance/i.test(clean(line.text || line)));
  if (at < 0) return null;
  const values = clean(lines[at + 1]?.text || "").split(" ");
  if (values.length !== 4 || !values.every((token) => /^-?[\d,]+\.\d{2}$/.test(token))) return null;
  const [openingBalance, withdrawal, deposit, closingBalance] = values.map((token) => roundMoney(parseAmount(token)));
  return { source: "printed", openingBalance, withdrawal, deposit, closingBalance };
}

function parseCsbTransactions(lines) {
  const transactions = [];
  const reconciliationIssues = [];
  const printedTotals = parseTotalsBox(lines);
  let current = null; // the row whose year and details are still being collected
  let broughtForward = null;

  const finish = () => {
    if (!current) return;
    const row = current;
    current = null;
    const label = `${String(row.day).padStart(2, "0")}-${Object.keys(MONTHS)[row.month]}`;
    if (row.amounts.length !== 3 || !Number.isInteger(row.year) || !Number.isInteger(row.month)) {
      reconciliationIssues.push(`A row dated ${label} has no readable year, debit, credit and balance and was left out.`);
      return;
    }
    const [debit, credit, balance] = row.amounts;
    if (/^B\/F\b/i.test(row.parts[0] || "")) {
      broughtForward = balance;
      return;
    }
    if ((debit > 0) === (credit > 0)) {
      reconciliationIssues.push(`A row dated ${label} ${row.year} prints ${debit > 0 ? "both a debit and a credit" : "neither a debit nor a credit"} and was left out.`);
      return;
    }
    transactions.push({
      date: new Date(Date.UTC(row.year, row.month, row.day)),
      particulars: joinParts(row.parts),
      chequeNo: row.reference ? clean(row.reference.text) : null,
      withdrawal: debit > 0 ? debit : null,
      deposit: credit > 0 ? credit : null,
      balance,
    });
  };

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;
    if (/^\*+\s*END OF STATEMENT/i.test(text)) break;

    const start = rowStart(entry);
    if (start) {
      finish();
      current = start;
      continue;
    }
    // The page footer ("Page 1 of 4" and the bank's contact table) follows the last row of a page: rows never
    // continue past it, so it closes the row instead of being read as narration.
    if (/^Page \d+ of \d+$/i.test(text)) {
      finish();
      continue;
    }
    if (!current) continue;

    const items = sorted(entry);
    const year = items.find((item) => item.x < DATE_X && YEAR.test(clean(item.text)));
    if (year && current.year === undefined) current.year = Number(clean(year.text));
    current.parts.push(...items.filter((item) => item.x >= DETAILS_X[0] && item.x < DETAILS_X[1]).map((item) => clean(item.text)));
  }
  finish();

  if (printedTotals && broughtForward !== null && printedTotals.openingBalance !== broughtForward) {
    reconciliationIssues.push("The balance brought forward does not match the printed opening balance.");
  }

  return { transactions, printedTotals, openingBalance: broughtForward ?? printedTotals?.openingBalance ?? null, reconciliationIssues };
}

export { isCsbLayout, parseCsbTransactions };
