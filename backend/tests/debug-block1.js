import fs from "node:fs/promises";
import { parseAxisOcrPage, parseAxisOcrStatement } from "../src/parsers/ocrColumnarParser.js";

// We copy the parseAxisOcrSubTable function to debug it locally
function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAxisAmount(raw) {
  if (!raw) return null;
  let text = clean(raw).replace(/[₹$€£]/g, "").replace(/Cr|Dr/gi, "").trim();
  if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) return null;
  const parts = text.split(/[.,]/);
  if (parts.length > 2) {
    const decimals = parts.pop();
    const integers = parts.join("");
    text = `${integers}.${decimals}`;
  } else if (parts.length === 2) {
    text = parts.join(".");
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return /^-/.test(raw) || /\bDr$/i.test(raw) ? -Math.abs(value) : value;
}

function isAxisSkippableDescription(value) {
  const text = clean(value);
  if (!text || /^B\/F/i.test(text)) return true;
  if (/^(opening|closing|average|avg)\s+balance/i.test(text)) return true;
  if (/^average\s+balance\s+maintained/i.test(text)) return true;
  if (/^break-up\s+of\s+consolidated\s+charges/i.test(text)) return true;
  if (/^(sr\.?\s*no\.?|type\s+of\s+fee|amount|additional\s+information)$/i.test(text)) return true;
  if (/^ecs\s+nach\s+transaction\s+fee/i.test(text)) return true;
  if (/^the\s+fees\s+above\s+may\s+have\s+elements/i.test(text)) return true;
  if (/^(txn\s+date|transaction|withdrawals|deposits|balance|other\s+information)$/i.test(text)) return true;
  if (/^(detailed\s+statement\s+for|account\s+no|branch\s+name|lien\s+amount|ifsc\s+code|micr\s+code|nominee\s+name|account\s+statement|quick\s+view|savings\s+bank|branch\s+sol|regd|email\s+id|mode\s+of\s+operation|type\s+of\s+account|joint\s+holders|nomination)/i.test(text)) return true;
  return false;
}

function groupAxisDescriptions(descriptions) {
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      const cleanedParts = current.map(part => clean(part).replace(/^\d{2}[./-]\d{2}[./-]\d{2,4}\s*/, ""));
      const merged = clean(cleanedParts.filter(p => p && !isAxisSkippableDescription(p)).join(" "));
      if (merged) groups.push(merged);
      current = [];
    }
  };
  const startsNewGroup = (text) =>
    /^\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(clean(text)) ||
    /^(I\/W CHQ RETURN|INWARD RETURN|CHQ PAID-MICR INWARD|BACBH\d|NEFT CHARGES|^GST$|NEFT DR-|VENTURES|CLEARING-SSCN|TO TRF|BY TRF|BY CTS|Opening Balance|Closing Balance)/i.test(text);

  for (const text of descriptions) {
    if (isAxisSkippableDescription(text)) continue;
    if (current.length > 0 && startsNewGroup(text)) flush();
    current.push(text);
  }
  flush();
  return groups;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function debugParseAxisOcrSubTable(tableLines, lastKnownDateObj, previousClosingBalance = null) {
  const texts = tableLines.map((line) => clean(line.text || line));
  const numericLines = [];
  const textLines = [];
  
  for (const text of texts) {
    if (isAxisSkippableDescription(text)) continue;
    
    if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) {
      textLines.push(text);
      continue;
    }
    
    const isNumber = /^-?[\d,.]+\.\d{2}$/.test(text) || /^-?[\d,.]+$/.test(text);
    if (isNumber && parseAxisAmount(text) !== null) {
      numericLines.push(parseAxisAmount(text));
    } else {
      textLines.push(text);
    }
  }
  
  const dates = [];
  for (const line of textLines) {
    const match = line.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})\b/);
    if (match) {
      const d = new Date(Date.UTC(Number(match[3]) < 100 ? Number(match[3])+2000 : Number(match[3]), Number(match[2]) - 1, Number(match[1])));
      dates.push(d);
    }
  }
  
  const narrationGroups = groupAxisDescriptions(textLines);
  const T_est = Math.max(dates.length, narrationGroups.length);
  const K = numericLines.length;
  
  console.log(`Sub-Table Debug: K = ${K}, T_est = ${T_est}, dates count = ${dates.length}, narrs count = ${narrationGroups.length}`);
  console.log("dates:", dates.map(d => d.toISOString().slice(0, 10)));
  console.log("narrationGroups:", narrationGroups);
  console.log("numericLines:", numericLines);
  
  if (T_est === 0) return [];
  
  let lastDate = lastKnownDateObj;
  const transactions = [];
  const isBalancesMissing = K < 1.8 * T_est;
  
  if (isBalancesMissing) {
    let runningBalance = previousClosingBalance !== null ? previousClosingBalance : 0;
    for (let i = 0; i < Math.min(K, T_est); i++) {
      const amount = Math.abs(numericLines[i]);
      let date = dates[i] || null;
      if (date) lastDate = date;
      else date = lastDate;
      
      const particulars = narrationGroups[i] || "TRANSACTION";
      const isDeposit = /(\bCR\b|Deposits|Deposit|BY\s+TRF|BY\s+CTS|Int\.Pd|REFUND|HB\s+INFOTECH|Rev\.of|Rev\s+of|SELF)/i.test(particulars);
      
      if (isDeposit) runningBalance = roundMoney(runningBalance + amount);
      else runningBalance = roundMoney(runningBalance - amount);
      
      transactions.push({
        date,
        particulars,
        chequeNo: null,
        withdrawal: isDeposit ? null : amount,
        deposit: isDeposit ? amount : null,
        balance: runningBalance,
      });
    }
  } else {
    const T = Math.floor((K - 1) / 2);
    let balances = numericLines.slice(T);
    if (previousClosingBalance !== null) {
      balances = [previousClosingBalance, ...balances];
    }
    for (let i = 1; i < balances.length; i++) {
      const prev = balances[i-1];
      const curr = balances[i];
      const delta = roundMoney(curr - prev);
      if (Math.abs(delta) < 0.01) continue;
      
      let date = dates[transactions.length] || null;
      if (date) lastDate = date;
      else date = lastDate;
      
      const particulars = narrationGroups[transactions.length] || "TRANSACTION";
      transactions.push({
        date,
        particulars,
        chequeNo: null,
        withdrawal: delta < 0 ? roundMoney(Math.abs(delta)) : null,
        deposit: delta > 0 ? roundMoney(delta) : null,
        balance: roundMoney(curr),
      });
    }
  }
  return transactions;
}

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const pageLines = ocrData.pages[1].lines; // Page 2 is index 1
  const startIndex = pageLines.findIndex(l => 
    /(Detailed Statement for|Account Statement|Txn Date|Date\s*Transaction)/i.test(clean(l.text || l))
  );
  const statementLines = pageLines.slice(startIndex);
  
  const blocks = [];
  let current = [];
  let seenBalances = false;

  for (const line of statementLines) {
    const text = clean(line.text || line);
    
    const isDate = /^\s*\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(text);
    const isBalanceKeyword = /^\s*(Balance|Closing Balance)\s*$/i.test(text);

    if (isBalanceKeyword) {
      seenBalances = true;
    }

    if (seenBalances && isDate) {
      blocks.push(current);
      current = [];
      seenBalances = false;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }
  
  console.log(`Split Page 2 into ${blocks.length} blocks.`);
  
  console.log("\n--- PARSING BLOCK 1 ---");
  const txns1 = debugParseAxisOcrSubTable(blocks[0], new Date(Date.UTC(2025, 3, 29)), 278.45);
  console.log(`Block 1 returned ${txns1.length} txns.`);
  txns1.forEach((t, i) => console.log(`  ${i+1}: Date: ${t.date.toISOString().slice(0, 10)}, Narration: ${t.particulars.slice(0, 30)}, Withdrawal: ${t.withdrawal}, Deposit: ${t.deposit}, Balance: ${t.balance}`));
  
  console.log("\n--- PARSING BLOCK 2 ---");
  const lastBal1 = txns1.length > 0 ? txns1[txns1.length - 1].balance : 278.45;
  const txns2 = debugParseAxisOcrSubTable(blocks[1], new Date(Date.UTC(2025, 3, 29)), lastBal1);
  console.log(`Block 2 returned ${txns2.length} txns.`);
  txns2.forEach((t, i) => console.log(`  ${i+1}: Date: ${t.date.toISOString().slice(0, 10)}, Narration: ${t.particulars.slice(0, 30)}, Withdrawal: ${t.withdrawal}, Deposit: ${t.deposit}, Balance: ${t.balance}`));
}

main().catch(console.error);
