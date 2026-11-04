import { clean, parseAmount, roundMoney } from "./common.js";

// HDFC Bank account statement with a real text layer (not scanned, not OCR). Columns:
//   Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
// - A transaction is one dated line followed by 0-4 narration lines that wrap BELOW it (the generic
//   parser treats lines as belonging to the NEXT row, which scrambled every narration).
// - Amounts are right-aligned, so their x start varies with their length: debit, credit and balance are
//   told apart by x bands taken from the header (debit < credit header, credit < balance header + margin),
//   not by comparing to one x. The balance is always the last amount.
// - Page headers (name/address block) and footers (bank notices) are never in the narration column, so
//   they are ignored; a wrapped narration that continues on the next page still attaches to its row.
// - Narration wrapping: the bank hard-wraps long UPI strings, so a break is mid-word (no space) once the
//   line is full, and at a word space only when the first line is short. A first line of FULL_LINE chars
//   or more is a hard break, and every later wrap is a hard break. Checked on a real 1,547-row UPI
//   statement: the 12-digit UPI reference stays intact in all of them (a plain space join breaks 76).
// - The last page prints a STATEMENT SUMMARY (opening, Dr/Cr counts, debits, credits, closing); it is
//   returned as printedTotals and the counts are checked against the rows read.

const HEADER = /^Date\s+Narration\s+Chq\.?\/Ref\.?\s*No\.?\s+Value Dt\s+Withdrawal Amt\.?\s+Deposit Amt\.?\s+Closing Balance/i;
const DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const AMOUNT = /^(?:\d{1,3}(?:,\d{2,3})+|\d*)\.\d{1,2}$/; // "55.00", "1,234,567.89", ".80"
const NARRATION_X = [60, 280]; // narration column; text left of it is the date, right of it the reference
const REFERENCE_X = [280, 360];
const FULL_LINE = 36; // the first narration line is 40 chars wide when it is full; shorter ones broke at a space
const DEFAULT_HEADER_X = { withdrawal: 405, deposit: 491, balance: 564 };

function isHdfcStatementLayout(lines) {
  const head = lines.slice(0, 120).map((line) => clean(line.text || line));
  return head.some((text) => HEADER.test(text)) && head.some((text) => /HDFC\s*0\d{6}|HDFC BANK/i.test(text));
}

function headerX(lines) {
  const entry = lines.slice(0, 120).find((line) => HEADER.test(clean(line.text || line)));
  const x = (pattern) => (entry?.items || []).find((item) => pattern.test(clean(item.text)))?.x;
  return {
    withdrawal: x(/^Withdrawal/i) ?? DEFAULT_HEADER_X.withdrawal,
    deposit: x(/^Deposit/i) ?? DEFAULT_HEADER_X.deposit,
    balance: x(/^Closing/i) ?? DEFAULT_HEADER_X.balance,
  };
}

const amountsOf = (items) => items.map((item) => ({ ...item, value: AMOUNT.test(clean(item.text)) ? parseAmount(item.text) : null })).filter((item) => item.value !== null);

function parseRow(entry, columns) {
  const items = [...(entry.items || [])].sort((left, right) => left.x - right.x);
  const match = items[0] && items[0].x < NARRATION_X[0] ? clean(items[0].text).match(DATE) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(2000 + Number(match[3]), Number(match[2]) - 1, Number(match[1])));

  const amounts = amountsOf(items.slice(1)).filter((item) => item.x > REFERENCE_X[1]);
  if (amounts.length !== 2) return { date, incomplete: true };
  const [amount, balance] = amounts;
  // Right-aligned: an amount is a credit when it starts right of the deposit header's start minus a margin,
  // and a debit when it starts left of it; the balance is further right still (its own band).
  const isCredit = amount.x >= columns.deposit - 6;
  const reference = items.slice(1).find((item) => item.x >= REFERENCE_X[0] && item.x < REFERENCE_X[1]);

  return {
    date,
    parts: [clean(items.slice(1).filter((item) => item.x >= NARRATION_X[0] && item.x < NARRATION_X[1]).map((item) => item.text).join(" "))],
    chequeNo: reference ? clean(reference.text) : null,
    withdrawal: isCredit ? null : Math.abs(amount.value),
    deposit: isCredit ? Math.abs(amount.value) : null,
    balance: roundMoney(balance.value),
  };
}

// "STATEMENT SUMMARY :-" then a header line and a line of six values:
// Opening Balance | Dr Count | Cr Count | Debits | Credits | Closing Bal
function parseSummary(lines) {
  const at = lines.findIndex((line) => /^STATEMENT SUMMARY/i.test(clean(line.text || line)));
  if (at < 0) return null;
  const values = lines
    .slice(at + 1, at + 4)
    .map((line) => clean(line.text || line).split(" "))
    .find((tokens) => tokens.length === 6 && tokens.every((token) => /^-?[\d,]+(?:\.\d+)?$/.test(token)));
  if (!values) return null;
  const [openingBalance, debitCount, creditCount, totalDebit, totalCredit, closingBalance] = values.map((token) => Number(token.replace(/,/g, "")));
  return { openingBalance, debitCount, creditCount, totalDebit, totalCredit, closingBalance };
}

function parseHdfcStatementTransactions(lines) {
  const columns = headerX(lines);
  const transactions = [];
  const reconciliationIssues = [];
  let current = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;
    if (/^STATEMENT SUMMARY/i.test(text)) break;

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

    // Wrapped narration: only text inside the narration column. Page headers/footers are outside it and
    // are ignored without ending the row, so a narration split across a page break stays together.
    const items = entry.items || [];
    if (current && items.length && items.every((item) => item.x >= NARRATION_X[0] && item.x < NARRATION_X[1])) {
      current.parts.push(text);
    }
  }

  for (const row of transactions) {
    const [first, ...rest] = row.parts;
    row.particulars = clean(rest.reduce((text, part, i) => text + (i === 0 && first.length < FULL_LINE ? " " : "") + part, first));
    delete row.parts;
  }

  const summary = parseSummary(lines);
  const debits = transactions.filter((row) => row.withdrawal !== null).length;
  const credits = transactions.filter((row) => row.deposit !== null).length;
  if (summary && summary.debitCount !== debits) reconciliationIssues.push(`The statement prints ${summary.debitCount} debits but ${debits} were read.`);
  if (summary && summary.creditCount !== credits) reconciliationIssues.push(`The statement prints ${summary.creditCount} credits but ${credits} were read.`);

  return {
    transactions,
    printedTotals: summary ? { source: "printed", withdrawal: summary.totalDebit, deposit: summary.totalCredit, closingBalance: summary.closingBalance } : null,
    openingBalance: summary?.openingBalance ?? null,
    reconciliationIssues,
  };
}

export { isHdfcStatementLayout, parseHdfcStatementTransactions };
