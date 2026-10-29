import { clean, parseAmount, parseDate } from "./common.js";

// Axis "Account Statement Report" (neo for corporates): S.NO | Transaction Date | Value Date |
// Particulars | Amount(INR) | Debit/Credit | Balance(INR) | Cheque Number | Branch Name(SOL).
// Unlike the older Axis layout (axisParser.js) one amount column carries a DR/CR flag.
const AMOUNT = /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}$/;
const HEADER = /^S\.NO Transaction\b.*\bParticulars Amount\(INR\) Debit\/Credit Balance\(INR\)/i;

function isAxisReportLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /Statement of Axis Bank Account No\s*:/i.test(text) && lines.some((line) => HEADER.test(clean(line.text || line)));
}

// Column left edges from the header row's word positions (the header repeats on every page).
function headerColumns(line) {
  const at = (pattern) => line.items.find((item) => pattern.test(item.text))?.x;
  return { particulars: at(/^Particulars$/i), amount: at(/^Amount\(INR\)$/i), cheque: at(/^Cheque$/i), branch: at(/^Branch/i) };
}

function extractPrintedTotals(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  let withdrawal = null;
  let deposit = null;
  let closingBalance = null;
  let openingBalance = null;
  texts.forEach((text, i) => {
    // "TRANSACTION TOTAL DR/CR 65,51,660.13/78" + ",11,508.00" when the cell wraps.
    if (/TRANSACTION TOTAL DR\/CR/i.test(text)) {
      const joined = `${text}${/^,/.test(texts[i + 1] || "") ? texts[i + 1] : ""}`.replace(/\s+/g, "");
      const match = joined.match(/DR\/CR(-?[\d,]+\.\d{2})\/(-?[\d,]+\.\d{2})/i);
      if (match) [withdrawal, deposit] = [parseAmount(match[1]), parseAmount(match[2])];
    }
    const closing = text.match(/^Closing Balance:\s*INR\s*(-?[\d,]+\.\d{2})/i);
    if (closing) closingBalance = parseAmount(closing[1]);
    const opening = text.match(/^Opening Balance:\s*INR\s*(-?[\d,]+\.\d{2})/i);
    if (opening) openingBalance = parseAmount(opening[1]);
  });
  if (withdrawal === null && closingBalance === null) return null;
  return { source: "printed", withdrawal, deposit, closingBalance, openingBalance };
}

// A row's amount/flag/balance line is top-aligned with its first particulars line, while S.NO and
// the dates sit at the row's vertical middle -- so a new row starts at each amount line, and the
// S.NO/date line can come after it.
function parseAxisReportTransactions(lines) {
  const printedTotals = extractPrintedTotals(lines);
  const transactions = [];
  let columns = null;
  let row = null;

  const finish = () => {
    if (row?.date) transactions.push({ ...row, particulars: clean(row.particulars.join(" ")) || "TRANSACTION" });
    row = null;
  };

  for (const line of lines) {
    const text = clean(line.text || line);
    if (HEADER.test(text)) {
      columns = line.items?.length ? headerColumns(line) : columns;
      continue;
    }
    if (!columns) continue;
    if (/TRANSACTION TOTAL/i.test(text)) break;
    if (/^Date \(dd\/mm\/yyyy\)|^\(dd\/mm\/yyyy\)$/i.test(text) || /^\d+\s+OPENING BALANCE\b/i.test(text)) continue;

    const items = line.items || [];
    const lead = items.filter((item) => item.x < columns.particulars - 2).map((item) => item.text);
    const particulars = items.filter((item) => item.x >= columns.particulars - 2 && item.x < columns.amount - 2).map((item) => item.text);
    const money = items.filter((item) => item.x >= columns.amount - 2 && item.x < columns.cheque - 2).map((item) => clean(item.text));
    const cheque = items.filter((item) => item.x >= columns.cheque - 2 && item.x < columns.branch - 2).map((item) => clean(item.text));

    const flagIndex = money.findIndex((value) => /^(?:CR|DR)$/i.test(value));
    if (flagIndex > 0 && AMOUNT.test(money[flagIndex - 1]) && AMOUNT.test(money[flagIndex + 1] || "")) {
      finish();
      const amount = Math.abs(parseAmount(money[flagIndex - 1]));
      const isCredit = /^CR$/i.test(money[flagIndex]);
      row = {
        sequence: transactions.length + 1,
        date: null,
        particulars: [],
        chequeNo: cheque.find((value) => /^\d+$/.test(value)) || null,
        withdrawal: isCredit ? null : amount,
        deposit: isCredit ? amount : null,
        balance: parseAmount(money[flagIndex + 1]),
      };
    }
    if (!row) continue;

    // "2 01/08/2026 01/08/2026": S.NO, transaction date, value date.
    if (lead.length >= 2 && /^\d+$/.test(lead[0]) && !row.date) row.date = parseDate(lead[1]);
    row.particulars.push(...particulars);
  }
  finish();

  return { transactions, printedTotals };
}

export { isAxisReportLayout, parseAxisReportTransactions };
