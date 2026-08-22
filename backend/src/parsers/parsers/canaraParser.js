import { amountItems, clean, parseDate, roundMoney, sortChronologically } from "./common.js";
import { correctDebitCreditByBalance } from "../validation.js";

function isCanaraLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /CANARA\s+BANK/i.test(text) && /TRANS\s+VALUE\s+BRANCH\s+REF\/CHQ\.NO\s+DESCRIPTION/i.test(text);
}

function isRowStart(entry) {
  const items = entry.items || [];
  return (
    items.some((item) => /^\d{2}-[A-Za-z]{3}-\d{2}$/.test(clean(item.text)) && item.x < 45) &&
    items.some((item) => /^\d{2}-[A-Za-z]{3}-\d{2}$/.test(clean(item.text)) && item.x > 60 && item.x < 95)
  );
}

function isNoise(text) {
  return (
    !text ||
    /^TRANS\s+VALUE\s+BRANCH/i.test(text) ||
    /^DATE\s+DATE$/i.test(text) ||
    /^STATEMENT OF ACCOUNT$/i.test(text) ||
    /^CANARA BANK$/i.test(text) ||
    /^\d+$/.test(text) ||
    /^(Account Branch|IFSC|MICR|Branch Address|Email Id|Contact Number|Bank Toll Free|WhatsApp|Account No|Product Name|Customer ID|Customer Name|Address|VPA Id|Nominee|Account Title|Joint Holder|Person's Name|CKYC Identifier|Period|Name Currency|Swift code)\b/i.test(text)
  );
}

function isTerminalLine(text) {
  return (
    /^Statement Summary\b/i.test(text) ||
    /END OF STATEMENT/i.test(text) ||
    /^UNLESS THE CONSTITUENT/i.test(text) ||
    /^BEWARE OF PHISHING/i.test(text) ||
    /^Details of Ombudsman/i.test(text)
  );
}

function parseRow(entry) {
  const items = [...(entry.items || [])].sort((left, right) => left.x - right.x);
  const transDate = items.find((item) => /^\d{2}-[A-Za-z]{3}-\d{2}$/.test(clean(item.text)) && item.x < 45);
  const date = parseDate(transDate?.text);
  if (!date) return null;

  const branch = clean(items.find((item) => item.x >= 120 && item.x < 170)?.text);
  const reference = clean(items.find((item) => item.x >= 175 && item.x < 255)?.text);
  const amounts = amountItems(items);
  const debitItem = amounts.find((item) => item.x >= 350 && item.x < 420);
  const creditItem = amounts.find((item) => item.x >= 420 && item.x < 500);
  const balanceItem = amounts.find((item) => item.x >= 500);
  const narration = clean(
    items
      .filter((item) => item.x >= 255 && item.x < 350)
      .map((item) => item.text)
      .join(" "),
  );

  let withdrawal = debitItem && Math.abs(debitItem.value) > 0 ? Math.abs(debitItem.value) : null;
  let deposit = creditItem && Math.abs(creditItem.value) > 0 ? Math.abs(creditItem.value) : null;
  if (/UPI\/DR/i.test(narration)) {
    withdrawal = withdrawal ?? (Math.abs(debitItem?.value || creditItem?.value || 0) || null);
    deposit = null;
  } else if (/UPI\/CR/i.test(narration)) {
    deposit = deposit ?? (Math.abs(creditItem?.value || debitItem?.value || 0) || null);
    withdrawal = null;
  }

  return {
    date,
    particulars: narration || "TRANSACTION",
    chequeNo: reference || branch || null,
    withdrawal,
    deposit,
    balance: balanceItem ? roundMoney(balanceItem.value) : null,
  };
}

function parseCanaraTransactions(lines) {
  const transactions = [];
  let current = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (isRowStart(entry)) {
      const row = parseRow(entry);
      if (!row || row.balance === null) continue;
      if (/^B\/F\b/i.test(row.particulars)) {
        current = null;
        continue;
      }
      transactions.push(row);
      current = row;
      continue;
    }

    if (current && isTerminalLine(text)) {
      current = null;
      continue;
    }

    if (!current || isNoise(text)) continue;
    current.particulars = clean(`${current.particulars} ${text}`);
  }

  return sortChronologically(correctDebitCreditByBalance(transactions));
}

export { isCanaraLayout, parseCanaraTransactions };
