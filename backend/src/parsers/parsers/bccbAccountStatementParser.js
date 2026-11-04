import { clean, parseAmount, roundMoney } from "./common.js";

// Bassein Catholic Co-op Bank (BCCB) internet-banking "Account Statement" PDF. Columns:
//   Transaction Date | Description | Reference Number | Value Date | Debit | Credit | Balance
// - Each transaction is one dated line followed by 1-5 description lines (the first part of the
//   description sits on the dated line, e.g. "UPI/", the rest wraps below it).
// - Only ONE of Debit / Credit is printed per row, in its own column, so which one it is comes from the
//   column x-position (nearest header), not from the amount's order. The balance is always the last amount.
// - The reference number (12 digits, or "BACB...") has no decimals, so it is never mistaken for an amount.
// - Small charges are printed without the leading zero (".80", ".14"), which the shared amountItems()
//   would skip; amounts are read here with a pattern that allows it.
// - Page headers/footers sit left of the description column and are never added to a description.
// - The last page prints an Account Summary (opening, closing, total debit/credit and counts); it is
//   returned as printedTotals so the statement is checked against the bank's own figures.

const HEADER = /^Transaction\s+Description\s+Reference Number\s+Value Date\s+Debit\s+Credit\s+Balance/i;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DESCRIPTION_X = [60, 180]; // continuation lines start here (header/footer text is further left)
const DEFAULT_COLUMNS = { debit: 360, credit: 431, balance: 502 };
const AMOUNT = /^(?:\d{1,3}(?:,\d{2,3})+|\d*)\.\d{1,2}$/; // "480.00", "4,350.00", ".80"
const amountsOf = (items) => items.map((item) => ({ ...item, value: AMOUNT.test(clean(item.text)) ? parseAmount(item.text) : null })).filter((item) => item.value !== null);

function isBccbAccountStatementLayout(lines) {
  const head = lines.slice(0, 120).map((line) => clean(line.text || line));
  return head.some((text) => HEADER.test(text)) && head.some((text) => /\bBACB\d|\bBCCB\b|Bassein/i.test(text));
}

// "01 Apr 2026" -> Date (UTC midnight), or null.
function parseLongDate(text) {
  const match = clean(text).match(/^(\d{2}) ([A-Za-z]{3}) (\d{4})$/);
  const month = match && MONTHS[match[2].toLowerCase()];
  return match && month !== undefined ? new Date(Date.UTC(Number(match[3]), month, Number(match[1]))) : null;
}

function headerColumns(lines) {
  const entry = lines.slice(0, 120).find((line) => HEADER.test(clean(line.text || line)));
  const x = (name) => (entry?.items || []).find((item) => clean(item.text).toLowerCase() === name)?.x;
  return { debit: x("debit") ?? DEFAULT_COLUMNS.debit, credit: x("credit") ?? DEFAULT_COLUMNS.credit, balance: x("balance") ?? DEFAULT_COLUMNS.balance };
}

function parseRow(entry, columns) {
  const items = [...(entry.items || [])].sort((left, right) => left.x - right.x);
  const date = items[0] && items[0].x < DESCRIPTION_X[0] ? parseLongDate(items[0].text) : null;
  if (!date) return null;

  const amounts = amountsOf(items.slice(1)).filter((item) => item.x > columns.debit - 40);
  if (amounts.length < 2) return { date, incomplete: true };
  const balance = amounts.at(-1);
  const amount = amounts.at(-2);
  const isDebit = Math.abs(amount.x - columns.debit) < Math.abs(amount.x - columns.credit);

  const inColumn = (item, from, to) => item.x >= from && item.x < to;
  const reference = items.slice(1).find((item) => inColumn(item, DESCRIPTION_X[1], 300) && !amounts.includes(item));
  return {
    date,
    particulars: clean(items.slice(1).filter((item) => inColumn(item, DESCRIPTION_X[0], DESCRIPTION_X[1])).map((item) => item.text).join(" ")),
    chequeNo: reference ? clean(reference.text) : null,
    withdrawal: isDebit ? Math.abs(amount.value) : null,
    deposit: isDebit ? null : Math.abs(amount.value),
    balance: roundMoney(balance.value),
  };
}

// "Opening Balance 10,000.00" style lines of the Account Summary (the value is the item after the label).
function parseSummary(lines) {
  const at = lines.findIndex((line) => /^Account Summary/i.test(clean(line.text || line)));
  if (at < 0) return null;
  const read = (label) => {
    const entry = lines.slice(at).find((line) => new RegExp(`^${label}\\b`, "i").test(clean(line.text || line)));
    const value = (entry?.items || []).map((item) => clean(item.text)).find((text) => /^-?[\d,]+(?:\.\d+)?$/.test(text));
    return value === undefined ? null : Number(value.replace(/,/g, ""));
  };
  return {
    openingBalance: read("Opening Balance"),
    closingBalance: read("Closing Balance"),
    totalDebit: read("Total Debit Amount"),
    totalCredit: read("Total Credit Amount"),
    debitCount: read("Total Number of Debits"),
    creditCount: read("Total Number of Credits"),
  };
}

function parseBccbAccountStatementTransactions(lines) {
  const columns = headerColumns(lines);
  const transactions = [];
  const reconciliationIssues = [];
  let current = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;
    if (/^Account Summary/i.test(text)) break;

    const row = parseRow(entry, columns);
    if (row?.incomplete) {
      current = null;
      reconciliationIssues.push(`A row dated ${row.date.toISOString().slice(0, 10)} has no readable amount and balance and was left out.`);
      continue;
    }
    if (row) {
      current = row;
      transactions.push(row);
      continue;
    }

    // Wrapped description: only text in the description column, never page headers/footers.
    const items = entry.items || [];
    if (current && items.length && items.every((item) => item.x >= DESCRIPTION_X[0] && item.x < DESCRIPTION_X[1])) {
      current.particulars = clean(`${current.particulars} ${text}`);
    }
  }

  const summary = parseSummary(lines);
  const debits = transactions.filter((row) => row.withdrawal !== null).length;
  const credits = transactions.filter((row) => row.deposit !== null).length;
  if (summary?.debitCount !== null && summary?.debitCount !== undefined && summary.debitCount !== debits) {
    reconciliationIssues.push(`The statement prints ${summary.debitCount} debits but ${debits} were read.`);
  }
  if (summary?.creditCount !== null && summary?.creditCount !== undefined && summary.creditCount !== credits) {
    reconciliationIssues.push(`The statement prints ${summary.creditCount} credits but ${credits} were read.`);
  }

  return {
    transactions,
    printedTotals: summary && summary.totalDebit !== null && summary.totalCredit !== null
      ? { source: "printed", withdrawal: summary.totalDebit, deposit: summary.totalCredit, closingBalance: summary.closingBalance }
      : null,
    openingBalance: summary?.openingBalance ?? null,
    reconciliationIssues,
  };
}

export { isBccbAccountStatementLayout, parseBccbAccountStatementTransactions };
