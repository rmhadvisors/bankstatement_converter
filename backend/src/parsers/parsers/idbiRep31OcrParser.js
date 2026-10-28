import { clean, parseDate, roundMoney } from "./common.js";

// Scanned IDBI "REP31 Customer Account Ledger Report", read from local-Tesseract word boxes
// (extractPdfLocally: pages[].words with left/top/width/height in image pixels). The text-layer
// version of this report is idbiLedgerParser.js; this one handles what only a scan has:
//  - pages out of order (a phone scanner put printed "Page 2" first) and a cover page with no rows,
//  - a slightly tilted scan, so a row's amounts sit lower than its date and Tesseract's own line
//    grouping mixes neighbouring rows -- rows are rebuilt from deskewed word positions instead,
//  - "1.67.482.84Cr" / "1,67.482.84C2" style amount misreads and Cr/Dr balance suffixes.
const DATE = /^\d{2}-\d{2}-\d{4}$/;
const MONEY = /^\d[\d.,]*\.\d{2}(?:[CD][A-Za-z0-9:]?)?$/i;

function isIdbiRep31OcrLayout(extraction) {
  if (extraction.source !== "ocr" || !extraction.pages?.some((page) => page.words?.length)) return false;
  const text = extraction.text || (extraction.lines || []).map((line) => line.text).join("\n");
  return /\bREP31\b/.test(text) && /Customer Account Ledger/i.test(text) && /Instr\w*|Number/i.test(text);
}

// "1.67.482.84Cr" -> { value: 167482.84, side: "Cr" }: the last "." before two digits is the
// decimal point, any other "." is a misread ",".
function parseOcrMoney(raw) {
  const match = clean(raw).replace(/\s+/g, "").match(/^(\d[\d.,]*)\.(\d{2})([CD])?/i);
  if (!match) return null;
  const whole = match[1].replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  return { value: Number(`${whole}.${match[2]}`), side: match[3] ? (match[3].toUpperCase() === "D" ? "Dr" : "Cr") : null };
}

// OCR digit confusions seen on this report (8 read as 6 or 3, and so on).
const CONFUSIONS = { 6: "8", 8: "6", 3: "8", 5: "6", 0: "8", 1: "7", 7: "1" };

// ponytail: only single-digit swaps from CONFUSIONS are tried, and only for a date outside the
// statement's own period. A misread that stays inside the period is not detectable this way.
function correctDate(raw, period) {
  const date = parseDate(raw);
  const inPeriod = (value) => value && (!period || (value >= period.start && value <= period.end));
  if (inPeriod(date)) return { date, corrected: false };
  for (let i = 0; i < raw.length; i++) {
    const swap = CONFUSIONS[raw[i]];
    if (!swap) continue;
    const candidate = parseDate(raw.slice(0, i) + swap + raw.slice(i + 1));
    if (inPeriod(candidate)) return { date: candidate, corrected: true };
  }
  return { date, corrected: false };
}

const box = (word) => ({ ...word, text: clean(word.text), x: word.left, cy: word.top + (word.height || 0) / 2 });

function headerColumns(words) {
  const find = (pattern, after = -Infinity) => words.find((word) => pattern.test(word.text) && word.x > after);
  const debit = find(/^Debit$/i);
  const credit = find(/^Credit$/i, debit?.x);
  const balance = find(/^Balance$/i, credit?.x ?? Infinity);
  const particulars = find(/^Particulars$/i);
  const tran = find(/^Tran$/i);
  const instrument = words.filter((word) => /^(?:Instr\w*|Number)$/i.test(word.text) && word.x < (particulars?.x ?? Infinity));
  if (!debit || !credit || !balance || !particulars) return null;
  return {
    headerY: Math.max(debit.cy, credit.cy),
    tran: tran?.x ?? 0,
    instrument: instrument.length ? Math.min(...instrument.map((word) => word.x)) : (tran?.x ?? 0) + 100,
    particulars: particulars.x,
    debit: debit.x,
    credit: credit.x,
    balance: balance.x,
  };
}

function printedPageNumber(words) {
  const index = words.findIndex((word, i) => /^page$/i.test(word.text) && /^\d+$/.test(words[i + 1]?.text || ""));
  return index >= 0 ? Number(words[index + 1].text) : null;
}

function parsePageRows(words, columns, period, notes) {
  const body = words.filter((word) => word.cy > columns.headerY + 5);
  const footer = body.find((word) => /^Page$/i.test(word.text) && /^Total$/i.test(body[body.indexOf(word) + 1]?.text || ""));
  const rowsArea = footer ? body.filter((word) => word.cy < footer.cy - 5) : body;

  // Row anchors: the GL date at the far left.
  const anchors = rowsArea.filter((word) => DATE.test(word.text) && word.x < columns.tran).sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const word of anchors) if (!rows.length || word.cy - rows.at(-1).anchor.cy > 8) rows.push({ anchor: word, words: [] });
  if (!rows.length) return [];

  // Tilt: pair the k-th row anchor with the k-th balance-column amount (one balance per row).
  const balances = rowsArea.filter((word) => word.x >= columns.balance - 20 && MONEY.test(word.text)).sort((a, b) => a.cy - b.cy);
  const slopes = rows.map((row, k) => balances[k] && (balances[k].cy - row.anchor.cy) / (balances[k].x - row.anchor.x)).filter(Number.isFinite).sort((a, b) => a - b);
  const slope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
  const x0 = rows[0].anchor.x;
  const level = (word) => word.cy - slope * (word.x - x0);

  for (const word of rowsArea) {
    let best = null;
    for (const row of rows) if (!best || Math.abs(level(word) - level(row.anchor)) < Math.abs(level(word) - level(best.anchor))) best = row;
    best.words.push(word);
  }

  return rows.map((row) => {
    const inColumn = (from, to) => row.words.filter((word) => word.x >= from && word.x < to).sort((a, b) => a.x - b.x || a.cy - b.cy);
    const money = (from, to) => inColumn(from, to).map((word) => (MONEY.test(word.text) ? parseOcrMoney(word.text) : null)).find(Boolean) ?? null;
    const debit = money(columns.debit - 150, columns.credit - 20);
    const credit = money(columns.credit - 20, columns.balance - 20);
    const balance = money(columns.balance - 20, Infinity);
    const dateWord = row.anchor.text;
    const { date, corrected } = correctDate(dateWord, period);
    if (corrected) notes.push(`OCR read a transaction date as ${dateWord}, outside the statement period; corrected to ${date.toISOString().slice(0, 10).split("-").reverse().join("-")}. Please verify.`);
    return {
      date,
      tranId: inColumn(columns.tran - 40, columns.instrument - 10).map((word) => word.text).join(" ") || null,
      chequeNo: inColumn(columns.instrument - 10, columns.particulars - 40).map((word) => word.text).find((text) => /^\d+$/.test(text)) ?? null,
      particulars:
        clean(
          row.words
            .filter((word) => word.x >= columns.particulars - 40 && word.x < columns.debit - 150 && !MONEY.test(word.text))
            .sort((a, b) => level(a) - level(b) > 6 ? 1 : level(b) - level(a) > 6 ? -1 : a.x - b.x)
            .map((word) => word.text)
            .join(" "),
        ) || "TRANSACTION",
      withdrawal: debit?.value ?? null,
      deposit: credit?.value ?? null,
      balance: balance ? (balance.side === "Dr" ? -balance.value : balance.value) : null,
    };
  });
}

function printedFigures(extraction) {
  const text = (extraction.lines || []).map((line) => clean(line.text).replace(/(\d[.,])\s+(?=\d)/g, "$1")).join("\n");
  const amount = (label) => {
    const match = text.match(new RegExp(`${label}\\s*\\S?\\s*([\\d.,]+\\.\\d{2}(?:[CD]\\S?)?)`, "i"));
    const money = match && parseOcrMoney(match[1]);
    return money ? (money.side === "Dr" ? -money.value : money.value) : null;
  };
  const periodMatch = text.match(/from\s+(\d{2}-\d{2}-\d{4})\s+to\s+(\d{2}-\d{2}-\d{4})/i);
  return {
    period: periodMatch ? { start: parseDate(periodMatch[1]), end: parseDate(periodMatch[2]) } : null,
    openingBalance: amount("Opening Balance"),
    closingBalance: amount("Closing Balance"),
    deposit: amount("(?<!Page )Total Credit"),
    withdrawal: amount("(?<!Page )Total Debit"),
  };
}

function parseIdbiRep31OcrTransactions(extraction) {
  const printed = printedFigures(extraction);
  const notes = [];
  const pages = extraction.pages
    .map((page) => ({ page, words: (page.words || []).map(box) }))
    .map((entry) => ({ ...entry, printed: printedPageNumber(entry.words) }))
    .sort((a, b) => (a.printed ?? a.page.pageNumber) - (b.printed ?? b.page.pageNumber));

  const transactions = [];
  for (const { words } of pages) {
    const columns = headerColumns(words);
    if (!columns) continue; // cover page: no ledger header, no rows
    for (const row of parsePageRows(words, columns, printed.period, notes)) transactions.push({ sequence: transactions.length + 1, ...row });
  }

  const reconciliationIssues = [];
  const sum = (key) => roundMoney(transactions.reduce((total, row) => total + (row[key] || 0), 0));
  if (printed.withdrawal !== null && Math.abs(sum("withdrawal") - printed.withdrawal) > 0.01) {
    reconciliationIssues.push(`Printed Total Debit is ${printed.withdrawal} but extracted debits total ${sum("withdrawal")}.`);
  }
  if (printed.deposit !== null && Math.abs(sum("deposit") - printed.deposit) > 0.01) {
    reconciliationIssues.push(`Printed Total Credit is ${printed.deposit} but extracted credits total ${sum("deposit")}.`);
  }

  return {
    transactions,
    openingBalance: printed.openingBalance,
    printedTotals: { source: "printed", openingBalance: printed.openingBalance, withdrawal: printed.withdrawal, deposit: printed.deposit, closingBalance: printed.closingBalance },
    reconciliationIssues,
    notes,
  };
}

export { isIdbiRep31OcrLayout, parseIdbiRep31OcrTransactions, parseOcrMoney };
