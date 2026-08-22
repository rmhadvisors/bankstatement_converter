import { clean, parseAmount, parseDate, roundMoney } from "./common.js";

function isSbiLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /State Bank of India/i.test(text) && /STATEMENT OF ACCOUNT/i.test(text) && /IFSC Code\s*:\s*SBIN/i.test(text);
}

function extractOpeningBalance(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const firstRow = texts.find((text) => /^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\b/.test(text));
  if (!firstRow) return null;

  const row = parseSbiTransactionLine(firstRow, [], null, 1);
  if (!row || row.balance === null) return null;

  return roundMoney(row.balance + Number(row.withdrawal || 0) - Number(row.deposit || 0));
}

function isHeaderOrFooter(text) {
  return (
    !text ||
    /^Welcome:/i.test(text) ||
    /^As on\b/i.test(text) ||
    /^Relationship Summary/i.test(text) ||
    /^Account Summary/i.test(text) ||
    /^STATEMENT OF ACCOUNT$/i.test(text) ||
    /^State Bank of India$/i.test(text) ||
    /^Page no\./i.test(text) ||
    /^Balance$/i.test(text) ||
    /^Please do not share/i.test(text) ||
    /^Each depositor is insured/i.test(text) ||
    /^interest amount held/i.test(text) ||
    /^(Branch|Date of Statement|Clear Balance|Uncleared Amount|Account Number|Product|IFSC Code|Currency|Monthly Avg Balance|Account Status|Interest Rate|CKYCR Number|Drawing Power|Account open Date|Statement From|Lien|Limit|MICR Code)\b/i.test(text) ||
    /^[A-Z ]+\s*:$/.test(text)
  );
}

function isTransactionDateLine(text) {
  return /^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\b/.test(clean(text));
}

function parseMoneyCell(raw) {
  const text = clean(raw);
  if (text === "-" || text === "") return null;
  return parseAmount(text);
}

function parseSbiTransactionLine(text, pendingNarration, previousBalance, sequence) {
  const match = clean(text).match(
    /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-|(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s+(-|(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s+(-|(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*$/,
  );
  if (!match) return null;

  const date = parseDate(match[1]);
  const valueDate = parseDate(match[2]);
  const lineNarration = clean(match[3]).replace(/\s+-$/, "");
  const debit = parseMoneyCell(match[4]);
  const credit = parseMoneyCell(match[5]);
  const balance = parseMoneyCell(match[6]);
  if (!date || balance === null) return null;

  let withdrawal = debit === null ? null : Math.abs(debit);
  let deposit = credit === null ? null : Math.abs(credit);

  if (previousBalance !== null && withdrawal === null && deposit === null) {
    const delta = roundMoney(balance - previousBalance);
    if (delta < 0) withdrawal = Math.abs(delta);
    if (delta > 0) deposit = delta;
  }

  return {
    sequence,
    date,
    valueDate,
    particulars: clean([...pendingNarration, lineNarration].join(" ")) || "TRANSACTION",
    chequeNo: null,
    withdrawal,
    deposit,
    balance,
  };
}

function parseSbiTransactions(lines) {
  const transactions = [];
  let previousBalance = null;
  let started = false;
  let pendingNarration = [];

  for (const line of lines) {
    const text = clean(line.text || line);

    if (/^Statement From\b/i.test(text) || /^Balance$/i.test(text)) {
      started = true;
      pendingNarration = [];
      continue;
    }

    if (!started) continue;
    if (isHeaderOrFooter(text)) continue;

    if (isTransactionDateLine(text)) {
      const row = parseSbiTransactionLine(text, pendingNarration, previousBalance, transactions.length + 1);
      if (row) {
        transactions.push(row);
        previousBalance = row.balance;
        pendingNarration = [];
      }
      continue;
    }

    pendingNarration.push(text);
  }

  return {
    transactions,
    printedTotals: null,
    openingBalance: extractOpeningBalance(lines),
  };
}

export { isSbiLayout, parseSbiTransactions };