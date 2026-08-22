import { amountItems, clean, parseDate, roundMoney, sortChronologically } from "./common.js";
import { correctDebitCreditByBalance } from "../validation.js";

function isBankOfIndiaLayout(lines) {
  const text = lines
    .slice(0, 120)
    .map((line) => clean(line.text || line))
    .join("\n");

  return (
    (/(BANK\s+OF\s+INDIA|IFSC:\s*BKID)/i.test(text) &&
      (/\|\s*DATE\s*\|\s*PARTICULARS\s*\|CHQ-NO\|\s*Debit\s*\|\s*Credit/i.test(text) ||
        /Sr No\s+Date\s+Remarks\s+Debit\s+Credit\s+Balance/i.test(text))) ||
    /IFSC:\s*BKID/i.test(text)
  );
}

function isPipeRowStart(text) {
  return /^\|\d{2}-\d{2}-\d{4}\|/.test(clean(text));
}

function isSrNoRowStart(entry) {
  const items = entry.items || [];
  return (
    items.some((item) => /^\d+$/.test(clean(item.text)) && item.x < 180) &&
    items.some((item) => /^\d{2}-\d{2}-\d{4}$/.test(clean(item.text)))
  );
}

function isNoiseLine(text) {
  return (
    !text ||
    /^Transaction Details\s+Page/i.test(text) ||
    /^BANK OF INDIA$/i.test(text) ||
    /^Combined accounts statement/i.test(text) ||
    /^Statement of operative account/i.test(text) ||
    /^For the period/i.test(text) ||
    /^https?:\/\//i.test(text) ||
    /^-+$/.test(text) ||
    /^\|?\s*(DATE|TYPE OF ACCOUNT|A\/c Number|B\/F)\b/i.test(text) ||
    /^SWEEP FACILITY/i.test(text) ||
    /^Report Date:/i.test(text)
  );
}

function isTerminalLine(text) {
  return (
    /^Summary of TDS\/Interest/i.test(text) ||
    /^\*\*\* Any discrepancy/i.test(text) ||
    /^MAKE USE OF RTGS\/NEFT/i.test(text) ||
    /^Bank of India Helpline/i.test(text) ||
    /^\*+ RELATIONSHIP BEYOND BANKING/i.test(text) ||
    /^Printed On\b/i.test(text)
  );
}

function parsePipeRow(entry) {
  const text = clean(entry.text || entry);
  const match = text.match(/^\|(\d{2}-\d{2}-\d{4})\|([^|]*)\|([^|]*)\|/);
  if (!match) return null;

  const date = parseDate(match[1]);
  if (!date) return null;

  const amounts = amountItems(entry.items || []);
  const debitItem = amounts.find((item) => item.x >= 390 && item.x < 470);
  const creditItem = amounts.find((item) => item.x >= 560 && item.x < 635);
  const balanceItem = amounts.find((item) => item.x >= 730) || amounts.at(-1);
  const particulars = clean(match[2]);
  const chequeNo = clean(match[3]).replace(/\|/g, "") || null;

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo,
    withdrawal: debitItem ? Math.abs(debitItem.value) : null,
    deposit: creditItem ? Math.abs(creditItem.value) : null,
    balance: balanceItem ? roundMoney(balanceItem.value) : null,
  };
}

function parseSrNoRow(entry) {
  const items = [...(entry.items || [])].sort((left, right) => left.x - right.x);
  const dateItem = items.find((item) => /^\d{2}-\d{2}-\d{4}$/.test(clean(item.text)));
  const date = parseDate(dateItem?.text);
  if (!date) return null;

  const amounts = amountItems(items);
  const debitItem = amounts.find((item) => item.x >= 780 && item.x < 940);
  const creditItem = amounts.find((item) => item.x >= 940 && item.x < 1120);
  const balanceItem = amounts.find((item) => item.x >= 1120) || amounts.at(-1);
  const amountStart = Math.min(debitItem?.x ?? 9999, creditItem?.x ?? 9999, balanceItem?.x ?? 9999);
  const particulars = clean(
    items
      .filter((item) => {
        const text = clean(item.text);
        if (/^\d+$/.test(text) && item.x < 180) return false;
        if (/^\d{2}-\d{2}-\d{4}$/.test(text)) return false;
        if (item.x >= amountStart - 8) return false;
        return item.x > (dateItem?.x || 200);
      })
      .map((item) => item.text)
      .join(" "),
  );

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo: null,
    withdrawal: debitItem ? Math.abs(debitItem.value) : null,
    deposit: creditItem ? Math.abs(creditItem.value) : null,
    balance: balanceItem ? roundMoney(balanceItem.value) : null,
  };
}

function parseBankOfIndiaTransactions(lines) {
  const transactions = [];
  let current = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;

    let row = null;
    if (isPipeRowStart(text)) {
      row = parsePipeRow(entry);
    } else if (isSrNoRowStart(entry)) {
      row = parseSrNoRow(entry);
    }

    if (row) {
      if (row.balance !== null) {
        transactions.push(row);
        current = row;
      }
      continue;
    }

    if (current && isTerminalLine(text)) {
      current = null;
      continue;
    }

    if (!current || isNoiseLine(text)) continue;
    current.particulars = clean(`${current.particulars} ${text.replace(/\|/g, " ")}`);
  }

  return sortChronologically(correctDebitCreditByBalance(transactions));
}

export { isBankOfIndiaLayout, parseBankOfIndiaTransactions };
