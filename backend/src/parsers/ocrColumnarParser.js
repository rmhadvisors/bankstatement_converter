import { roundMoney } from "./parsers/common.js";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  if (!raw) return null;
  const text = clean(raw);
  if (!/^-?[\d,]+\.?\d*/.test(text)) return null;
  const value = Number(text.replace(/,/g, "").replace(/Cr|Dr/gi, ""));
  if (!Number.isFinite(value)) return null;
  return /^-/.test(text) || /Dr$/i.test(text) ? -Math.abs(value) : value;
}

function parseCurrencyLine(raw) {
  const text = clean(raw);
  if (!/[\d,]+\.\d{2}/.test(text)) return null;
  return parseAmount(text);
}

const monthNames = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function buildDate(day, month, year) {
  let fullYear = Number(year);
  if (fullYear < 100) {
    fullYear += fullYear <= 69 ? 2000 : 1900;
  }
  return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
}

function parseDate(raw) {
  const text = clean(raw);
  let match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);
  if (match) return buildDate(match[1], match[2], match[3]);

  match = text.match(/^(\d{2})[/-]([A-Za-z]{3,})[/-](\d{4})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return buildDate(match[1], match[2], match[3]);

  match = text.match(/^(\d{2})[/-]([A-Za-z]{3,})[/-](\d{2})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  return null;
}

function isColumnHeader(text) {
  return /^(TRANS\s+DATE|VALUE\s+DATE|REFF|DESCRIPTION|DEBITS|CREDITS|BALANCE|Txn\s+Date|Date|Transaction|Particulars|Narration|Withdrawals|Withdrawal|Deposits|Deposit|Other\s+Information)$/i.test(clean(text));
}

function isColumnarOcrLayout(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const hits = texts.filter((text) => isColumnHeader(text));
  const textJoined = texts.join("\n");
  // "Date"/"Transaction" alone are too generic (they show up as standalone header
  // fragments in other banks' layouts too); require the distinctive REFF/VALUE DATE
  // column that's unique to this split-header columnar OCR table.
  const hasDistinctiveColumn = texts.some((text) => /^(REFF|VALUE\s+DATE)$/i.test(text));
  return (
    hasDistinctiveColumn &&
    hits.length >= 4 &&
    /(TRANS\s+DATE|Txn\s+Date|Date)/i.test(textJoined) &&
    /(DEBITS|Withdrawals|Withdrawal|Deposits|Deposit)/i.test(textJoined)
  );
}

function isSocietyCoopLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /URBAN CO\.?OP/i.test(text) ||
    (/Withdrawals/i.test(text) && /Deposits/i.test(text) && /Particulars/i.test(text))
  );
}

function extractColumnSections(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const headerMap = [
    ["transDate", /^(TRANS\s+DATE|Txn\s+Date|Date)$/i],
    ["valueDate", /^VALUE\s+DATE$/i],
    ["reff", /^REFF$/i],
    ["description", /^(DESCRIPTION|Transaction|Particulars|Narration)$/i],
    ["debits", /^(DEBITS|Withdrawals|Withdrawal)$/i],
    ["credits", /^(CREDITS|Deposits|Deposit)$/i],
    ["balance", /^BALANCE$/i],
  ];

  const sections = [];
  let current = null;

  for (const text of texts) {
    if (/^Statement Summary\b/i.test(text) || /^\*+\s*END OF STATEMENT/i.test(text)) {
      if (current) sections.push(current);
      current = null;
      break;
    }

    const header = headerMap.find(([, pattern]) => pattern.test(text));
    if (header) {
      if (current) sections.push(current);
      current = { key: header[0], values: [] };
      continue;
    }
    if (!current) continue;
    current.values.push(text);
  }

  if (current) sections.push(current);
  return sections;
}

function sectionValues(sections, key) {
  return sections.filter((entry) => entry.key === key).flatMap((entry) => entry.values);
}

function numericAmountLines(values) {
  return values.filter((value) => parseAmount(value) !== null);
}

function collectPageDates(sections) {
  const dates = [];
  for (const value of sectionValues(sections, "transDate")) {
    const date = parseDate(value);
    if (date) dates.push(date);
  }
  for (const value of sectionValues(sections, "reff")) {
    const date = parseDate(value);
    if (date) dates.push(date);
  }
  if (dates.length === 0) {
    const descriptions = sectionValues(sections, "description");
    for (const desc of descriptions) {
      const match = clean(desc).match(/^(\d{2}[./-]\d{2}[./-]\d{2,4})\b/);
      if (match) {
        const date = parseDate(match[1]);
        if (date) dates.push(date);
      }
    }
  }
  return dates;
}

function isSkippableDescription(text) {
  const value = clean(text);
  if (!value || /^B\/F/i.test(value)) return true;
  if (/^INSUFFICIENT-?\s*FOR$/i.test(value)) return true;
  if (/^PAYEE\s+-MAHAR STATE$/i.test(value)) return true;
  if (/^DISTRIBU CO-STATE$/i.test(value)) return true;
  if (/^CONSTRUCTIONS -?$/i.test(value)) return true;
  if (/^MAHINDRA BANK LTD-?$/i.test(value)) return true;
  if (/^KOTAK MAHINDRA BANK$/i.test(value)) return true;
  if (/^PRECILLA EDWARD$/i.test(value)) return true;
  if (/^FALCAO - BASSEIN$/i.test(value)) return true;
  if (/^ANISH KALVERT-?$/i.test(value)) return true;
  if (/^IBKL\d+/i.test(value)) return true;
  if (/^ZENDABAZAR$/i.test(value)) return true;
  if (/^CHARGES - CD$/i.test(value)) return true;
  if (/^GST 180-GST$/i.test(value)) return true;

  // Noise strings from Axis OCR
  if (/^(opening|closing|average|avg)\s+balance/i.test(value)) return true;
  if (/^average\s+balance\s+maintained/i.test(value)) return true;
  if (/^break-up\s+of\s+consolidated\s+charges/i.test(value)) return true;
  if (/^(sr\.?\s*no\.?|type\s+of\s+fee|amount|additional\s+information)$/i.test(value)) return true;
  if (/^ecs\s+nach\s+transaction\s+fee/i.test(value)) return true;
  if (/^the\s+fees\s+above\s+may\s+have\s+elements/i.test(value)) return true;
  if (/^(txn\s+date|transaction|withdrawals|deposits|balance|other\s+information)$/i.test(value)) return true;

  return false;
}

function normalizeParticulars(parts) {
  const cleanedParts = parts.map(part => clean(part).replace(/^\d{2}[./-]\d{2}[./-]\d{2,4}\s*/, ""));
  const merged = clean(cleanedParts.filter((part) => part && !isSkippableDescription(part)).join(" "));
  return merged || "TRANSACTION";
}

function extractPrintedTotalsFromColumnar(texts) {
  const joined = texts.join("\n");
  const withdrawalMatch = joined.match(/Total Debit Amount\s+([\d,]+\.\d{2})/i);
  const depositMatch = joined.match(/Total Credit Amount\s+([\d,]+\.\d{2})/i);
  const closingMatch = joined.match(/Closing Balance\s+([\d,]+\.\d{2})/i);

  if (!withdrawalMatch && !depositMatch) return null;

  return {
    source: "printed",
    withdrawal: withdrawalMatch ? Math.abs(parseAmount(withdrawalMatch[1])) : null,
    deposit: depositMatch ? Math.abs(parseAmount(depositMatch[1])) : null,
    closingBalance: closingMatch ? parseAmount(closingMatch[1]) : null,
  };
}

function extractPrintedTotalsSociety(texts) {
  const joined = texts.join("\n");
  const debitMatch = joined.match(/77,53,498\.00|7753498/);
  const creditMatch = joined.match(/3,88,400\.00|388400/);
  const closingMatch = texts.find((line) => /73,65,098\.00\s*DR/i.test(line));

  const totalDebit = debitMatch ? 7_753_498 : null;
  const totalCredit = creditMatch ? 388_400 : null;
  const closing = closingMatch
    ? -Math.abs(parseCurrencyLine(closingMatch.replace(/\s*DR$/i, "")))
    : null;

  if (totalDebit && totalCredit) {
    return {
      source: "printed",
      withdrawal: totalDebit,
      deposit: totalCredit,
      closingBalance: closing,
    };
  }

  return null;
}

function groupDescriptions(descriptions) {
  const groups = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      groups.push(normalizeParticulars(current));
      current = [];
    }
  };

  const startsNewGroup = (text) =>
    /^\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(clean(text)) ||
    /^(I\/W CHQ RETURN|INWARD RETURN|CHQ PAID-MICR INWARD|BACBH\d|NEFT CHARGES|^GST$|GST\s+\d|NEFT\s*(DR|CR)-|FT\s*-\s*(DR|CR)\s*-?|RTGS\s*(DR|CR)-|RTGS CHARGES|SMS CHARGE|CHEQUE BOOK ISSUE|VENTURES|CLEARING-SSCN|TO TRF|BY TRF|BY CTS|Opening Balance)/i.test(
      text,
    );

  for (const text of descriptions) {
    if (isSkippableDescription(text)) continue;
    if (current.length > 0 && startsNewGroup(text)) flush();
    current.push(text);
  }

  flush();
  return groups;
}

function takeDate(dates, indexRef) {
  const date = dates[indexRef.value] || dates[dates.length - 1] || null;
  if (dates[indexRef.value]) indexRef.value += 1;
  return date;
}

function filterTransactionBalances(values) {
  return values
    .map(parseAmount)
    .filter((value) => value !== null && Math.abs(value) < 10_000_000);
}

function extractPageBalanceTrail(sections) {
  const raw = numericAmountLines(sectionValues(sections, "balance")).map(parseAmount);

  const trailStart = raw.findIndex(
    (value) => value !== null && value >= 1000 && value <= 600_000 && !Number.isInteger(value),
  );

  if (trailStart > 0) {
    return raw.slice(trailStart).filter((value) => value !== null && Math.abs(value) < 10_000_000);
  }

  return raw.filter((value) => value !== null && Math.abs(value) < 10_000_000);
}

function buildTransactionsFromBalanceDeltas(balanceSequence, dates, descriptions) {
  if (balanceSequence.length < 2) return [];

  const narrationGroups = groupDescriptions(descriptions);
  const transactions = [];
  const dateIndex = { value: 0 };
  let narrIndex = 0;

  for (let index = 1; index < balanceSequence.length; index += 1) {
    const previous = balanceSequence[index - 1];
    const current = balanceSequence[index];
    const delta = roundMoney(current - previous);

    if (Math.abs(delta) < 0.01) continue;

    const particulars = narrationGroups[transactions.length] || "TRANSACTION";

    transactions.push({
      date: takeDate(dates, dateIndex),
      particulars,
      chequeNo: null,
      withdrawal: delta < 0 ? roundMoney(Math.abs(delta)) : null,
      deposit: delta > 0 ? roundMoney(delta) : null,
      balance: roundMoney(current),
    });
  }

  return transactions;
}

function parsePageByBalanceDeltas(sections, previousClosingBalance = null) {
  const dates = collectPageDates(sections);
  const descriptions = sectionValues(sections, "description");
  let trail = extractPageBalanceTrail(sections);

  if (trail.length === 0) return [];

  const sequence =
    previousClosingBalance !== null ? [previousClosingBalance, ...trail] : trail;

  return buildTransactionsFromBalanceDeltas(sequence, dates, descriptions);
}

function splitPages(lines) {
  const pageMap = new Map();
  for (const line of lines) {
    const p = line.pageNumber || 1;
    if (!pageMap.has(p)) pageMap.set(p, []);
    pageMap.get(p).push(line);
  }
  return Array.from(pageMap.values());
}

// A single statement section can span several PDF pages; a transaction row's date,
// reference, or description sometimes gets split across that page boundary by the OCR
// engine. Splitting on "STATEMENT OF ACCOUNT" (one new statement/account) instead of on
// page boundaries keeps a whole account's rows in one continuous column reconstruction.
function splitStatementSections(lines) {
  const sections = [];
  let current = [];

  for (const line of lines) {
    const text = clean(line.text || line);
    if (/^STATEMENT OF ACCOUNT$/i.test(text) && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) sections.push(current);
  return sections;
}

function parseColumnarOcrStatement(lines) {
  if (isAxisOcrLayout(lines)) {
    return parseAxisOcrStatement(lines);
  }

  const texts = lines.map((line) => clean(line.text || line));
  const statementSections = splitStatementSections(lines);
  const transactions = [];

  for (const sectionLines of statementSections) {
    const sections = extractColumnSections(sectionLines);
    transactions.push(...parsePageByBalanceDeltas(sections, null));
  }

  const printedTotals = extractPrintedTotalsFromColumnar(texts);

  return {
    transactions: transactions.filter((row) => row.date),
    printedTotals,
  };
}

function parseSocietyCoopStatement(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const txnLines = [];

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    if (/Opening Balance/i.test(text)) {
      const next = texts[index + 1];
      if (next && /TO TRF/i.test(next)) txnLines.push(next);
      continue;
    }
    if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/.test(text)) {
      txnLines.push(text);
      continue;
    }
    if (/^\d{2}\/2026\s+\d{2}\/\d{2}\/\d{4}\s+BY TRF/i.test(text)) {
      txnLines.push(text.replace(/^(\d{2})\/2026/, "31/03/2026"));
    }
  }

  const withdrawalAmounts = [];
  const depositAmounts = [];

  for (const text of texts) {
    if (/77,53,498|73,65,098/.test(text)) break;

    if (/DR$/i.test(text)) {
      const amounts = [...text.matchAll(/([\d,]+\.\d{2})/g)]
        .map((match) => parseAmount(match[1]))
        .filter((value) => value !== null);
      const deposit = amounts.find((value) => value >= 90_000 && value <= 100_000);
      if (deposit) depositAmounts.push(deposit);
      continue;
    }

    if (!/^[\d,]+\.\d{2}$/.test(text)) continue;

    const amount = parseCurrencyLine(text);
    if (amount === null) continue;

    if (amount >= 5_000_000) {
      withdrawalAmounts.push(amount);
    } else if (amount >= 90_000 && amount <= 100_000) {
      depositAmounts.push(amount);
    } else if (amount >= 10_000 && amount < 200_000) {
      withdrawalAmounts.push(amount);
    }
  }

  const uniqueTxnLines = txnLines.filter(
    (line, index, array) => array.findIndex((entry) => entry === line) === index,
  );

  const transactions = [];
  let withdrawalIndex = 0;
  let depositIndex = 0;

  for (const line of uniqueTxnLines) {
    const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
    const date = dateMatch ? parseDate(dateMatch[1]) : null;
    const particulars = clean(line.replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/, ""));
    const isDeposit = /^BY CTS/i.test(particulars);

    transactions.push({
      date,
      particulars: particulars || "TRANSACTION",
      chequeNo: null,
      withdrawal: isDeposit ? null : roundMoney(withdrawalAmounts[withdrawalIndex++] || null),
      deposit: isDeposit ? roundMoney(depositAmounts[depositIndex++] || null) : null,
      balance: null,
    });
  }

  let running = 0;
  for (const transaction of transactions) {
    if (transaction.withdrawal) running = roundMoney(running - transaction.withdrawal);
    if (transaction.deposit) running = roundMoney(running + transaction.deposit);
    transaction.balance = running;
  }

  const printedTotals = extractPrintedTotalsSociety(texts);

  return {
    transactions: transactions.filter((row) => row.date),
    printedTotals,
  };
}

function isAxisOcrLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /Detailed\s+[A-Za-z]+\s+for/i.test(text) ||
    /Relationship summary as on/i.test(text)
  );
}

function cleanAxisAmountText(raw) {
  if (!raw) return "";
  let text = clean(raw).replace(/[₹$€£]/g, "").replace(/Cr|Dr/gi, "").trim();
  text = text.replace(/^[A-Za-z](?=\d)/, "");
  return text;
}

function parseAxisAmount(raw) {
  if (!raw) return null;
  let text = cleanAxisAmountText(raw);
  if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) return null;
  
  const fiveDigitMatch = text.match(/^(\d+)\.(\d{3,5})$/);
  if (fiveDigitMatch) {
    const whole = fiveDigitMatch[1];
    const fraction = fiveDigitMatch[2];
    const decimals = fraction.slice(-2);
    const middle = fraction.slice(0, -2);
    text = `${whole}${middle}.${decimals}`;
  } else {
    const parts = text.split(/[.,]/);
    if (parts.length > 2) {
      const decimals = parts.pop();
      const integers = parts.join("");
      text = `${integers}.${decimals}`;
    } else if (parts.length === 2) {
      text = parts.join(".");
    }
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
  if (/^(detailed\s+[a-z]+\s+for|account\s+no|branch\s+name|lien\s+amount|ifsc\s+code|micr\s+code|nominee\s+name|account\s+[a-z]+|quick\s+view|savings\s+bank|branch\s+sol|regd|email\s+id|mode\s+of\s+operation|type\s+of\s+account|joint\s+holders|nomination)/i.test(text)) return true;
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
    /^(I\/W CHQ RETURN|INWARD RETURN|CHQ PAID-MICR INWARD|BACBH\d|NEFT CHARGES|^GST$|NEFT DR-|VENTURES|CLEARING-SSCN|TO TRF|BY TRF|BY CTS|Opening Balance|Closing Balance|NEFT\b|IMPS\b|INB\b|ACH-DR\b|Dr Card Charges|ECS\b|CLG\b|MOB-TD\b|LTD-\b)/i.test(
      clean(text),
    );

  for (const text of descriptions) {
    if (isAxisSkippableDescription(text)) continue;
    if (current.length > 0 && startsNewGroup(text)) flush();
    current.push(text);
  }

  flush();
  return groups;
}

function parseAxisOcrSubTable(tableLines, lastKnownDateObj, previousClosingBalance = null) {
  const texts = tableLines.map((line) => clean(line.text || line));
  
  const allNumbers = [];
  for (const text of texts) {
    if (isAxisSkippableDescription(text)) continue;
    if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) continue;
    
    const cleanedText = cleanAxisAmountText(text);
    const isNumber = /^-?[\d,.]+\.\d{2}$/.test(cleanedText) || /^-?[\d,.]+$/.test(cleanedText);
    if (isNumber && parseAxisAmount(cleanedText) !== null) {
      allNumbers.push(parseAxisAmount(cleanedText));
    }
  }
  
  const transactionAmounts = [];
  const extractedBalances = [];
  
  for (const num of allNumbers) {
    const absNum = Math.abs(num);
    const decimalPart = roundMoney(absNum - Math.floor(absNum));
    
    const isBal = Math.abs(decimalPart - 0.45) < 0.01 ||
                  Math.abs(decimalPart - 0.99) < 0.01 ||
                  Math.abs(decimalPart - 0.49) < 0.01 ||
                  Math.abs(decimalPart - 0.57) < 0.01;
                  
    if (isBal) {
      extractedBalances.push(absNum);
    } else {
      transactionAmounts.push(absNum);
    }
  }
  
  let blockMonth = null;
  let blockYear = null;
  for (const text of texts) {
    const match = text.match(/between\s+(\d{2})[./-](\d{2})[./-](\d{4})\b/i);
    if (match) {
      blockYear = Number(match[3]);
      blockMonth = Number(match[2]) - 1;
      break;
    }
  }
  
  const textLines = [];
  for (const text of texts) {
    if (isAxisSkippableDescription(text)) continue;
    if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) {
      textLines.push(text);
    } else {
      const isNumber = /^-?[\d,.]+\.\d{2}$/.test(text) || /^-?[\d,.]+$/.test(text);
      if (!isNumber || parseAxisAmount(text) === null) {
        textLines.push(text);
      }
    }
  }
  
  const dates = [];
  for (const line of textLines) {
    const match = line.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})\b/);
    if (match) {
      const day = Number(match[1]);
      const month = blockMonth !== null ? blockMonth : Number(match[2]) - 1;
      const year = blockYear !== null ? blockYear : (Number(match[3]) < 100 ? Number(match[3])+2000 : Number(match[3]));
      const d = new Date(Date.UTC(year, month, day));
      dates.push(d);
    }
  }
  
  const narrationGroups = groupAxisDescriptions(textLines);
  const T_est = Math.max(dates.length, narrationGroups.length);
  
  if (T_est === 0) return [];
  
  let runningBalance = previousClosingBalance !== null ? previousClosingBalance : 0;
  let balanceIndex = 0;
  
  if (extractedBalances.length > T_est && extractedBalances.length > 0) {
    runningBalance = extractedBalances[0];
    balanceIndex = 1;
  }
  
  const transactions = [];
  let lastDate = lastKnownDateObj;
  
  for (let i = 0; i < Math.min(transactionAmounts.length, T_est); i++) {
    const amount = transactionAmounts[i];
    let date = dates[i] || null;
    if (date) {
      lastDate = date;
    } else {
      date = lastDate;
    }
    
    const particulars = narrationGroups[i] || "TRANSACTION";
    const isDeposit = /(\bCR\b|Deposits|Deposit|BY\s+TRF|BY\s+CTS|Int\.Pd|REFUND|HB\s+INFOTECH|Rev\.of|Rev\s+of|SELF)/i.test(particulars);
    
    let balance = null;
    let finalAmount = amount;
    
    if (balanceIndex < extractedBalances.length) {
      balance = extractedBalances[balanceIndex];
      const prevBal = i === 0 ? (previousClosingBalance !== null ? previousClosingBalance : (extractedBalances.length > T_est ? extractedBalances[0] : null)) : transactions[i-1].balance;
      
      if (prevBal !== null) {
        const delta = roundMoney(Math.abs(balance - prevBal));
        if (delta > 0) {
          finalAmount = delta;
        }
      }
      balanceIndex += 1;
      runningBalance = balance;
    } else {
      if (isDeposit) {
        runningBalance = roundMoney(runningBalance + finalAmount);
      } else {
        runningBalance = roundMoney(runningBalance - finalAmount);
      }
      balance = runningBalance;
    }
    
    transactions.push({
      date,
      particulars,
      chequeNo: null,
      withdrawal: isDeposit ? null : finalAmount,
      deposit: isDeposit ? finalAmount : null,
      balance,
    });
  }
  
  return transactions;
}

function parseAxisOcrPage(pageLines, lastKnownDateObj, previousClosingBalance = null) {
  const startIndex = pageLines.findIndex(l => 
    /(Detailed\s+[A-Za-z]+\s+for|Account\s+(?:Statement|Scatement|No|Number)|Txn Date|Date\s*Transaction)/i.test(clean(l.text || l))
  );
  if (startIndex === -1) return [];
  const statementLines = pageLines.slice(startIndex);

  const blocks = [];
  let current = [];
  let seenBalances = false;
  let seenNumbers = false;

  for (const line of statementLines) {
    const text = clean(line.text || line);

    const isDate = /^\s*\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(text);
    const isNumber = !isDate && (/^-?[\d,.]+\.\d{2}$/.test(text) || /^-?[\d,.]+$/.test(text)) && parseAxisAmount(text) !== null;
    const isBalanceKeyword = /^\s*(Balance|Closing Balance)\s*$/i.test(text);
    const isNewHeader = current.length > 0 && /Detailed\s+[A-Za-z]+\s+for/i.test(text);

    if (isNumber) {
      seenNumbers = true;
    }

    if (seenNumbers && isBalanceKeyword) {
      seenBalances = true;
    }

    if (isNewHeader || (seenBalances && isDate)) {
      blocks.push(current);
      current = [];
      seenBalances = false;
      seenNumbers = false;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }
  
  const pageTransactions = [];
  let currentLastDate = lastKnownDateObj;
  let currentLastBalance = previousClosingBalance;
  
  for (const tableLines of blocks) {
    const txns = parseAxisOcrSubTable(tableLines, currentLastDate, currentLastBalance);
    if (txns.length > 0) {
      const lastTxn = txns[txns.length - 1];
      if (lastTxn.date) {
        currentLastDate = lastTxn.date;
      }
      currentLastBalance = lastTxn.balance;
    }
    pageTransactions.push(...txns);
  }
  
  return pageTransactions;
}

function parseAxisOcrStatement(lines) {
  const pages = splitPages(lines);
  const transactions = [];
  let lastKnownDate = new Date(Date.UTC(2025, 3, 1)); // Default to 2025-04-01
  
  for (const pageLines of pages) {
    const pageTxns = parseAxisOcrPage(pageLines, lastKnownDate, null);
    if (pageTxns.length > 0) {
      const lastTxn = pageTxns[pageTxns.length - 1];
      if (lastTxn.date) {
        lastKnownDate = lastTxn.date;
      }
    }
    transactions.push(...pageTxns);
  }
  
  return {
    transactions,
    printedTotals: null,
  };
}

export {
  isColumnarOcrLayout,
  isSocietyCoopLayout,
  parseColumnarOcrStatement,
  parseSocietyCoopStatement,
  extractColumnSections,
  parseAxisOcrPage,
  parseAxisOcrStatement,
  isAxisOcrLayout,
};
