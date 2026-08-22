import { clean, roundMoney, parseDate } from "./parsers/common.js";

function parseAmount(raw) {
  if (!raw) return null;
  const text = clean(raw).replace(/[₹,]/g, "").replace(/Cr|Dr/gi, "");
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return /^-/.test(text) || /Dr$/i.test(clean(raw)) ? -Math.abs(value) : value;
}

const AMOUNT_PATTERN = /(?:₹\s*)?-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*(?:Cr|Dr))?/i;

function isAmountText(value) {
  return AMOUNT_PATTERN.test(clean(value));
}

function amountItems(items = []) {
  return items
    .map((item) => ({ x: item.x, text: clean(item.text), value: parseAmount(item.text) }))
    .filter((item) => item.value !== null && isAmountText(item.text));
}

function isBankOfIndiaLayout(lines) {
  const text = lines
    .slice(0, 60)
    .map((line) => clean(line.text || line))
    .join("\n");

  return /IFSC:\s*BKID/i.test(text) && /Sr No\s+Date\s+Remarks\s+Debit\s+Credit\s+Balance/i.test(text);
}

function detectColumns(lines) {
  for (const entry of lines.slice(0, 80)) {
    const text = clean(entry.text || entry);
    if (!/Sr No\s+Date\s+Remarks\s+Debit\s+Credit\s+Balance/i.test(text)) continue;

    const findX = (pattern) => {
      const item = (entry.items || []).find((candidate) => pattern.test(clean(candidate.text)));
      return item ? item.x : null;
    };

    return {
      debit: findX(/^Debit$/i),
      credit: findX(/^Credit$/i),
      balance: findX(/^Balance$/i),
    };
  }

  return { debit: 820, credit: 1020, balance: 1210 };
}

function isRowStart(entry) {
  const items = entry.items || [];
  return (
    items.some((item) => /^\d+$/.test(clean(item.text)) && item.x < 180) &&
    items.some((item) => /^\d{2}-\d{2}-\d{4}$/.test(clean(item.text)))
  );
}

function parseRowHeader(entry, columns) {
  const items = entry.items || [];
  const dateItem = items.find((item) => /^\d{2}-\d{2}-\d{4}$/.test(clean(item.text)));
  const date = dateItem ? parseDate(dateItem.text) : null;
  if (!date) return null;

  const amounts = amountItems(items);
  const amountItem = amounts
    .filter((item) => item.x < (columns.balance || 1200) - 40)
    .sort((left, right) => right.x - left.x)[0];
  if (!amountItem) return null;

  const narration = clean(
    items
      .filter((item) => {
        const text = clean(item.text);
        if (/^\d+$/.test(text) && item.x < 180) return false;
        if (/^\d{2}-\d{2}-\d{4}$/.test(text)) return false;
        if (isAmountText(text)) return false;
        return item.x > (dateItem?.x || 230) && item.x < amountItem.x - 8;
      })
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" "),
  );

  const distanceToDebit = Math.abs(amountItem.x - (columns.debit || 820));
  const distanceToCredit = Math.abs(amountItem.x - (columns.credit || 1020));

  return {
    date,
    particulars: narration || "TRANSACTION",
    chequeNo: null,
    withdrawal: distanceToDebit <= distanceToCredit ? Math.abs(amountItem.value) : null,
    deposit: distanceToCredit < distanceToDebit ? Math.abs(amountItem.value) : null,
    balance: null,
    transactionAmount: Math.abs(amountItem.value),
  };
}

function parseBalanceLine(entry) {
  const items = entry.items || [];
  const rightAmount = amountItems(items).sort((left, right) => right.x - left.x)[0];
  if (rightAmount) return rightAmount.value;

  const match = clean(entry.text || entry).match(AMOUNT_PATTERN);
  return match ? parseAmount(match[0]) : null;
}

function isNoiseLine(text) {
  return (
    !text ||
    /^Detailed Statement$/i.test(text) ||
    /^Date:/i.test(text) ||
    /^NOTE:?$/i.test(text) ||
    /^Any discrepancy/i.test(text) ||
    /^Please do not share/i.test(text) ||
    /^this statement\b/i.test(text) ||
    /^and Passwords\b/i.test(text) ||
    /^Sr No\s+Date\s+Remarks/i.test(text) ||
    /^(Account holder|Customer ID|Account number|Transaction Date|Amount from|Cheque from|Transaction type)/i.test(
      text,
    )
  );
}

function applyBalanceClassification(transactions) {
  for (let index = 0; index < transactions.length; index += 1) {
    const row = transactions[index];
    const older = transactions[index + 1];
    if (!older || row.balance === null || older.balance === null) continue;

    const delta = roundMoney(row.balance - older.balance);
    if (Math.abs(delta) < 0.01) {
      row.withdrawal = null;
      row.deposit = null;
    } else if (delta > 0) {
      row.withdrawal = null;
      row.deposit = roundMoney(Math.abs(delta));
    } else {
      row.withdrawal = roundMoney(Math.abs(delta));
      row.deposit = null;
    }
  }

  for (const row of transactions) {
    delete row.transactionAmount;
  }

  return transactions;
}

function parseBankOfIndiaTransactions(lines) {
  const columns = detectColumns(lines);
  const transactions = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (isRowStart(entry)) {
      const row = parseRowHeader(entry, columns);
      if (!row) continue;

      const next = lines[index + 1];
      const balance = next ? parseBalanceLine(next) : null;
      if (balance !== null) {
        row.balance = roundMoney(balance);
        index += 1;
      }

      transactions.push(row);
      current = row;
      continue;
    }

    if (!current || isNoiseLine(text) || isAmountText(text)) continue;
    current.particulars = clean(`${current.particulars} ${text}`);
  }

  return applyBalanceClassification(transactions).filter((row) => row.date && row.balance !== null);
}

export { isBankOfIndiaLayout, parseBankOfIndiaTransactions };
