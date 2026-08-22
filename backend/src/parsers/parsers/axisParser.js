import { clean, parseAmount, parseDate, roundMoney } from "./common.js";

function isAxisLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /Statement of (?:Axis )?Account No\s*:/i.test(text) && /Tran Date Chq No Particulars Debit Credit Balance Init\./i.test(text);
}

function extractOpeningBalance(lines) {
  for (const line of lines) {
    const text = clean(line.text || line);
    if (!/^OPENING BALANCE\b/i.test(text)) continue;
    const amount = text.match(/-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}/);
    return amount ? parseAmount(amount[0]) : null;
  }

  return null;
}

function extractPrintedTotals(lines) {
  let withdrawal = null;
  let deposit = null;
  let closingBalance = null;

  for (const line of lines) {
    const text = clean(line.text || line);
    const amounts = text.match(/-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}/g) || [];

    if (/^TRANSACTION TOTAL\b/i.test(text) && amounts.length >= 2) {
      withdrawal = Math.abs(parseAmount(amounts[0]));
      deposit = Math.abs(parseAmount(amounts[1]));
    }

    if (/^CLOSING BALANCE\b/i.test(text) && amounts.length >= 1) {
      closingBalance = parseAmount(amounts[0]);
    }
  }

  if (withdrawal === null && deposit === null && closingBalance === null) return null;

  return {
    source: "printed",
    withdrawal,
    deposit,
    closingBalance,
  };
}

function isTransactionDateLine(text) {
  return /^\d{2}-\d{2}-\d{4}\b/.test(clean(text));
}

function isIgnorable(text) {
  return (
    !text ||
    /^Tran Date\b/i.test(text) ||
    /^Br$/i.test(text) ||
    /^OPENING BALANCE\b/i.test(text) ||
    /^TRANSACTION TOTAL\b/i.test(text) ||
    /^CLOSING BALANCE\b/i.test(text) ||
    /^Unless\b/i.test(text) ||
    /^The closing balance\b/i.test(text) ||
    /^We would like\b/i.test(text) ||
    /^With effect\b/i.test(text) ||
    /^Deposit Insurance\b/i.test(text) ||
    /^In compliance\b/i.test(text) ||
    /^To ensure\b/i.test(text) ||
    /^REGISTERED OFFICE\b/i.test(text) ||
    /^BRANCH ADDRESS\b/i.test(text) ||
    /^Legends?\s*:/i.test(text) ||
    /^\+{2,}\s*End of Statement/i.test(text)
  );
}

function parseTransactionLine(text, pendingNarration, previousBalance, sequence) {
  const match = clean(text).match(
    /^(\d{2}-\d{2}-\d{4})\s+(.*?)\s+((?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s+((?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})(?:\s+\S+)?$/,
  );
  if (!match) return null;

  const date = parseDate(match[1]);
  const lineNarration = clean(match[2]);
  const amount = Math.abs(parseAmount(match[3]));
  const balance = parseAmount(match[4]);
  if (!date || amount === null || balance === null) return null;

  const delta = previousBalance === null ? null : roundMoney(balance - previousBalance);
  let withdrawal = null;
  let deposit = null;

  if (delta !== null && Math.abs(Math.abs(delta) - amount) <= 0.05) {
    if (delta < 0) withdrawal = amount;
    if (delta > 0) deposit = amount;
  } else {
    withdrawal = amount;
  }

  return {
    sequence,
    date,
    particulars: clean([...pendingNarration, lineNarration].join(" ")) || "TRANSACTION",
    chequeNo: null,
    withdrawal,
    deposit,
    balance,
  };
}

function parseAxisTransactions(lines) {
  const transactions = [];
  const printedTotals = extractPrintedTotals(lines);
  let previousBalance = extractOpeningBalance(lines);
  let started = false;
  let pendingNarration = [];

  for (const line of lines) {
    const text = clean(line.text || line);

    if (/^Tran Date\b/i.test(text)) {
      started = true;
      pendingNarration = [];
      continue;
    }

    if (!started) continue;
    if (/^TRANSACTION TOTAL\b/i.test(text) || /^CLOSING BALANCE\b/i.test(text)) break;
    if (isIgnorable(text)) continue;

    if (isTransactionDateLine(text)) {
      const row = parseTransactionLine(text, pendingNarration, previousBalance, transactions.length + 1);
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
    printedTotals,
  };
}

export { isAxisLayout, parseAxisTransactions };
