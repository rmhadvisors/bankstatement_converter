import { roundMoney } from "./parsers/common.js";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[А]/g, "A")
    .replace(/[а]/g, "a")
    .replace(/[Р]/g, "P")
    .replace(/[р]/g, "p")
    .replace(/[Г]/g, "R")
    .replace(/[г]/g, "r")
    .replace(/[М]/g, "M")
    .replace(/[м]/g, "m")
    .replace(/[О]/g, "O")
    .replace(/[о]/g, "o")
    .replace(/\b5ep\b/gi, "Sep")
    .replace(/\b0ct\b/gi, "Oct")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = clean(raw);
  const text = /^\d+,\d{2}(?:\s*(?:Cr|Dr))?$/i.test(cleaned)
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  const normalized = text.replace(/^(-?)\./, "$10.").replace(/Cr|Dr/gi, "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return /^-/.test(text) || /Dr$/i.test(text) ? -Math.abs(value) : value;
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
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function parseDate(raw) {
  const text = clean(raw).replace(/^['"*]+/, "");
  const match = text.match(/^(\d{2})\/([A-Za-z0-9]{3})\/(\d{4})$/);
  if (!match) return null;

  const monthToken = match[2].replace(/^0/i, "O").replace(/^5/i, "S").slice(0, 3).toLowerCase();
  const month = monthNames[monthToken];
  return month ? buildDate(match[1], month, match[3]) : null;
}

function isAmountLine(text) {
  const value = clean(text);
  return (
    /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+|\.\d+)\.\d{1,2}(?:\s*(?:Cr|Dr))?$/i.test(value) ||
    /^-?\d+,\d{2}(?:\s*(?:Cr|Dr))?$/i.test(value)
  );
}

function isInlineHeaderLine(text) {
  return (
    /^Sr\.\s+Value\s+Date\s+Transaction\s+Particulars/i.test(text) ||
    /^No\.\s+Date\s+Number\s+Balance$/i.test(text)
  );
}

function isVvsbLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /VASAI\s+VIKAS\s+SAHAKARI\s+BANK/i.test(text) && /STATEMENT OF ACCOUNT/i.test(text);
}

function nextAmountAfter(texts, startIndex) {
  for (let index = startIndex + 1; index < Math.min(texts.length, startIndex + 8); index += 1) {
    const amount = parseAmount(texts[index]);
    if (amount !== null) return amount;
  }
  return null;
}

function extractPrintedTotals(texts) {
  let openingBalance = null;
  let withdrawal = null;
  let deposit = null;
  let closingBalance = null;

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    if (/^Opening Balance$/i.test(text)) openingBalance = nextAmountAfter(texts, index);
    if (/^Debits$/i.test(text)) withdrawal = nextAmountAfter(texts, index);
    if (/^Credits$/i.test(text)) deposit = nextAmountAfter(texts, index);
    if (/^Closing Bal$/i.test(text)) closingBalance = nextAmountAfter(texts, index);
  }

  return {
    openingBalance,
    printedTotals:
      withdrawal !== null || deposit !== null || closingBalance !== null
        ? {
            source: "printed",
            withdrawal: withdrawal === null ? null : Math.abs(withdrawal),
            deposit: deposit === null ? null : Math.abs(deposit),
            closingBalance,
          }
        : null,
  };
}

const inlineDatePattern = "['*]?\\d{2}\\/[A-Za-z0-9]{3}\\/\\d{4}";
const inlineAmountPattern = "-?(?:\\d{1,3}(?:,\\d{2,3})+|\\d+|\\.\\d+)\\.\\d{1,2}";
const inlineRowPattern = new RegExp(
  `^(\\d+)\\s+(${inlineDatePattern})\\s+(${inlineDatePattern})\\s+(.+?)\\s+([A-Z0-9]{3,}|\\d+)\\s+(${inlineAmountPattern})\\s+(${inlineAmountPattern})\\s+(${inlineAmountPattern})$`,
  "i",
);

function parseInlineRow(text) {
  const match = clean(text).match(inlineRowPattern);
  if (!match) return null;

  const withdrawal = Math.abs(parseAmount(match[6]) || 0);
  const deposit = Math.abs(parseAmount(match[7]) || 0);

  return {
    sequence: Number(match[1]),
    date: parseDate(match[3]) || parseDate(match[2]),
    valueDate: parseDate(match[2]) || parseDate(match[3]),
    particulars: clean(match[4]) || "TRANSACTION",
    chequeNo: clean(match[5]) || null,
    withdrawal: withdrawal > 0 ? withdrawal : null,
    deposit: deposit > 0 ? deposit : null,
    balance: parseAmount(match[8]),
  };
}

function isInlineTerminalLine(text) {
  return (
    /^\*{5,}$/.test(text) ||
    /^STATEMENT SUMMARY/i.test(text) ||
    /^Opening Balance\s+Dr Count\s+Cr Count\s+Debits\s+Credits\s+Closing Bal/i.test(text) ||
    /^\*+\s*END OF STATEMENT/i.test(text) ||
    /^Page\s+\d+\s+of\s+\d+$/i.test(text)
  );
}

function parseInlineVvsbTransactions(texts) {
  const transactions = [];
  let current = null;

  for (const raw of texts) {
    const text = clean(raw);
    if (!text || isInlineHeaderLine(text)) continue;
    if (isInlineTerminalLine(text)) {
      current = null;
      continue;
    }

    const row = parseInlineRow(text);
    if (row) {
      transactions.push(row);
      current = row;
      continue;
    }

    if (!current) continue;
    current.particulars = clean(`${current.particulars} ${text}`);
  }

  return transactions;
}

function extractBalanceTrail(texts) {
  const balances = [];

  for (let index = 0; index < texts.length; index += 1) {
    if (!/^Closing$/i.test(texts[index]) || !/^Balance$/i.test(texts[index + 1] || "")) continue;

    for (let cursor = index + 2; cursor < texts.length; cursor += 1) {
      const text = texts[cursor];
      if (/^(STATEMENT SUMMARY|Scanned|Page|Sr\.?|No\.?)\b/i.test(text)) break;
      if (!isAmountLine(text)) {
        if (balances.length > 0) break;
        continue;
      }

      const amount = parseAmount(text);
      if (amount !== null) balances.push(amount);
    }
  }

  return balances;
}

function extractNarrationCandidates(texts) {
  const candidates = [];
  const datePattern = /['"*]?\d{2}\/[^/\s]{3}\/\d{4}/g;
  let inParticulars = false;
  let current = null;

  const flush = () => {
    if (!current) return;
    const particulars = clean(
      current.parts
        .join(" ")
        .replace(datePattern, " ")
        .replace(/\b0{6}\b/g, " ")
        .replace(/\s+/g, " "),
    );
    candidates.push({
      date: current.date,
      particulars: particulars || "TRANSACTION",
    });
    current = null;
  };

  for (const raw of texts) {
    const text = clean(raw);
    if (/^Particulars$/i.test(text)) {
      inParticulars = true;
      continue;
    }

    if (/^(Chq\.\/Ref\.|Debit|Credit|Closing|Page \d|Scanned)/i.test(text)) {
      inParticulars = false;
      flush();
      continue;
    }

    if (!inParticulars) continue;

    const dates = [...text.matchAll(datePattern)]
      .map((match) => parseDate(match[0]))
      .filter(Boolean);

    if (dates.length > 0) {
      const remainder = clean(text.replace(datePattern, " "));
      if (current && /^(\w{1,2}\s+\d{4}\b|er\s+\d{4}\b)/i.test(remainder)) {
        current.parts.push(remainder);
        continue;
      }

      if (current && current.parts.length === 0) {
        current.date = current.date || dates[0];
        if (remainder) current.parts.push(remainder);
        continue;
      }

      if (current && (current.parts.length > 0 || remainder)) flush();
      current = {
        date: dates[0],
        parts: remainder ? [remainder] : [],
      };
      continue;
    }

    if (current) current.parts.push(text);
  }

  flush();
  return candidates.filter((row) => row.date);
}

function parseVvsbTransactions(lines) {
  const texts = lines.map((line) => clean(line.text || line)).filter(Boolean);
  const { openingBalance, printedTotals } = extractPrintedTotals(texts);
  const inlineTransactions = parseInlineVvsbTransactions(texts);

  if (inlineTransactions.length > 0) {
    return {
      transactions: inlineTransactions,
      printedTotals,
    };
  }

  const balances = extractBalanceTrail(texts);
  const narrations = extractNarrationCandidates(texts);
  const transactions = [];

  let previousBalance = openingBalance;
  for (let index = 0; index < balances.length; index += 1) {
    const balance = roundMoney(balances[index]);
    const narration = narrations[index] || narrations[narrations.length - 1] || {};
    let withdrawal = null;
    let deposit = null;

    if (previousBalance !== null) {
      const delta = roundMoney(balance - previousBalance);
      if (delta < 0) withdrawal = Math.abs(delta);
      if (delta > 0) deposit = delta;
    }

    transactions.push({
      date: narration.date || null,
      particulars: narration.particulars || "TRANSACTION",
      chequeNo: null,
      withdrawal,
      deposit,
      balance,
    });

    previousBalance = balance;
  }

  return {
    transactions,
    printedTotals,
  };
}

export { isVvsbLayout, parseVvsbTransactions };
