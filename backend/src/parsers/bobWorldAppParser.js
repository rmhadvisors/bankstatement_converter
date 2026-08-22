import { roundMoney } from "./parsers/common.js";

function clean(value) {
  return String(value || "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  const text = clean(raw).replace(/,/g, "");
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const AMOUNT_PATTERN = /^\d{1,3}(?:,\d{2,3})*\.\d{2}$/;
const DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;
const HEADER_LABELS = ["Description", "Cheque", "Debit", "Credit", "Balance"];

function isNoiseLine(text) {
  return (
    !text ||
    /this is a computer-generated statement/i.test(text) ||
    /generated on \d{2}\/\d{2}\/\d{4}/i.test(text) ||
    /bob world mobile app/i.test(text) ||
    /system maintained in the bank/i.test(text) ||
    /^bank of baroda$/i.test(text) ||
    /^bob$/i.test(text) ||
    /^world$/i.test(text) ||
    /^account statement from/i.test(text) ||
    /^account (name|number|type|details)$/i.test(text) ||
    /^(branch|customer|ifsc|micr) (name|address|code)$/i.test(text) ||
    /^\d{6}$/.test(text) ||
    /^(debit|credit|balance|cheque|number|description)$/i.test(text) ||
    /swill|tradattion/i.test(text) ||
    /discrepancy/i.test(text) ||
    /raise a complaint/i.test(text) ||
    /aintained in the bank/i.test(text) ||
    /page \d+ of \d+/i.test(text) ||
    /carried out in normal course of busine/i.test(text)
  );
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function detectHeaderColumns(lines) {
  const found = {};
  for (const label of HEADER_LABELS) {
    const xs = [];
    for (const entry of lines) {
      for (const item of entry.items || []) {
        if (clean(item.text).toLowerCase() === label.toLowerCase()) xs.push(item.x);
      }
    }
    found[label.toLowerCase()] = median(xs);
  }
  return found;
}

function detectDateColumns(lines, descriptionStart) {
  const bins = new Map();
  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!DATE_PATTERN.test(text)) continue;
    const x = (entry.items || [])[0]?.x;
    if (!Number.isFinite(x)) continue;
    if (descriptionStart !== null && x >= descriptionStart) continue;
    const bin = Math.round(x / 25) * 25;
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }

  const sortedBins = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const topTwo = sortedBins.slice(0, 2).map(([x]) => x).sort((a, b) => a - b);
  return { transactionDateX: topTwo[0] ?? null, valueDateX: topTwo[1] ?? null };
}

function detectSerialColumn(lines, transactionDateX) {
  const bins = new Map();
  for (const entry of lines) {
    const items = entry.items || [];
    if (items.length !== 1) continue;
    const item = items[0];
    if (!/^\d{1,4}$/.test(clean(item.text))) continue;
    if (transactionDateX !== null && item.x >= transactionDateX - 30) continue;
    const bin = Math.round(item.x / 25) * 25;
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }
  const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

function isBankOfBarodaWorldAppLayout(lines) {
  const text = lines
    .slice(0, 120)
    .map((line) => clean(line.text || line))
    .join("\n");

  const hasBranding = /bank of baroda/i.test(text);
  const hasColumns =
    /\bDescription\b/.test(text) &&
    /\bCheque\b/.test(text) &&
    /\bDebit\b/.test(text) &&
    /\bCredit\b/.test(text) &&
    /\bBalance\b/.test(text);

  return hasBranding && hasColumns;
}

function buildColumnLayout(lines) {
  const header = detectHeaderColumns(lines);
  const descriptionStart = header.description ?? null;
  const { transactionDateX, valueDateX } = detectDateColumns(lines, descriptionStart);
  const serialX = detectSerialColumn(lines, transactionDateX);

  return {
    serialX,
    transactionDateX,
    valueDateX,
    descriptionStart: valueDateX !== null ? valueDateX + 90 : 660,
    descriptionEnd: (header.cheque ?? 1420) - 60,
    chequeX: header.cheque ?? null,
    debitX: header.debit ?? null,
    creditX: header.credit ?? null,
    balanceX: header.balance ?? null,
  };
}

function nearestAmountColumn(x, layout) {
  const columns = [
    ["debit", layout.debitX],
    ["credit", layout.creditX],
    ["balance", layout.balanceX],
  ].filter(([, position]) => position !== null && position !== undefined);

  columns.sort((a, b) => Math.abs(x - a[1]) - Math.abs(x - b[1]));
  return columns[0]?.[0] ?? "balance";
}

function isSerialLine(entry, layout) {
  const items = entry.items || [];
  if (items.length === 0) return false;
  const item = items[0];
  if (!/^\d{1,4}$/.test(clean(item.text))) return false;
  if (layout.serialX === null) return true;
  return Math.abs(item.x - layout.serialX) <= 40;
}

function extractDateAt(entry, columnX, tolerance = 40) {
  if (columnX === null) return null;
  const text = clean(entry.text || entry);
  const match = text.match(DATE_PATTERN);
  if (!match) return null;
  const x = (entry.items || [])[0]?.x;
  if (!Number.isFinite(x) || Math.abs(x - columnX) > tolerance) return null;
  return { day: match[1], month: match[2], year: match[3] };
}

function extractAmountsFromEntry(entry, layout) {
  const results = [];
  for (const item of entry.items || []) {
    const text = clean(item.text);
    if (!AMOUNT_PATTERN.test(text)) continue;
    if (layout.descriptionStart !== null && item.x < layout.descriptionStart) continue;
    const value = parseAmount(text);
    if (value === null) continue;
    results.push({ x: item.x, value, column: nearestAmountColumn(item.x, layout) });
  }
  return results;
}

function extractDescriptionText(entry, layout) {
  const items = (entry.items || []).filter((item) => {
    const text = clean(item.text);
    if (!text) return false;
    if (AMOUNT_PATTERN.test(text)) return false;
    if (DATE_PATTERN.test(text) && item.x < layout.descriptionStart) return false;
    return item.x >= layout.descriptionStart - 40;
  });
  if (items.length === 0) return "";
  return clean(items.map((item) => item.text).join(" "));
}

function toDate(dateParts) {
  if (!dateParts) return null;
  return new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day)));
}

// Build row anchors (opening-balance line + each serial-number line) and, per page, the
// top-position band each anchor owns (midpoint between neighbouring anchors on that page).
// The OCR reading order interleaves a row's own description/amount lines with the *next*
// row's anchor before that anchor line is reached, so we can't rely on "most recently
// started row" state during a single forward pass — we bucket by vertical band instead.
function buildRowAnchors(lines, layout) {
  const anchors = [];
  let openingSeen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const text = clean(entry.text || entry);
    if (!text || isNoiseLine(text)) continue;

    if (!openingSeen && /opening balance/i.test(text)) {
      anchors.push({ index, pageNumber: entry.pageNumber, top: entry.top, isOpening: true });
      openingSeen = true;
      continue;
    }

    if (isSerialLine(entry, layout)) {
      anchors.push({
        index,
        pageNumber: entry.pageNumber,
        top: entry.top,
        serialNo: Number(clean((entry.items || [])[0]?.text)),
      });
    }
  }

  const byPage = new Map();
  anchors.forEach((anchor, i) => {
    if (!byPage.has(anchor.pageNumber)) byPage.set(anchor.pageNumber, []);
    byPage.get(anchor.pageNumber).push({ ...anchor, orderIndex: i });
  });

  for (const pageAnchors of byPage.values()) {
    pageAnchors.sort((a, b) => a.top - b.top);
    for (let i = 0; i < pageAnchors.length; i += 1) {
      const prevTop = i > 0 ? pageAnchors[i - 1].top : -Infinity;
      const nextTop = i < pageAnchors.length - 1 ? pageAnchors[i + 1].top : Infinity;
      pageAnchors[i].bandStart = i === 0 ? -Infinity : (prevTop + pageAnchors[i].top) / 2;
      pageAnchors[i].bandEnd = i === pageAnchors.length - 1 ? Infinity : (pageAnchors[i].top + nextTop) / 2;
    }
  }

  return anchors.map((a) => byPage.get(a.pageNumber).find((p) => p.orderIndex === anchors.indexOf(a)));
}

function findAnchorForLine(entry, anchorsByPage) {
  const pageAnchors = anchorsByPage.get(entry.pageNumber);
  if (!pageAnchors || pageAnchors.length === 0) return null;
  const top = entry.top;
  if (top === null || top === undefined) return pageAnchors[pageAnchors.length - 1];
  return pageAnchors.find((anchor) => top >= anchor.bandStart && top < anchor.bandEnd) || null;
}

function parseBankOfBarodaWorldAppTransactions(lines) {
  const layout = buildColumnLayout(lines);
  const anchors = buildRowAnchors(lines, layout);

  const anchorsByPage = new Map();
  for (const anchor of anchors) {
    if (!anchorsByPage.has(anchor.pageNumber)) anchorsByPage.set(anchor.pageNumber, []);
    anchorsByPage.get(anchor.pageNumber).push(anchor);
  }

  const rows = anchors.map((anchor, i) => ({
    serialNo: anchor.isOpening ? 0 : anchor.serialNo ?? i,
    transactionDate: null,
    valueDate: null,
    particularsParts: [],
    chequeNo: null,
    debit: null,
    credit: null,
    balance: null,
    isOpeningBalance: !!anchor.isOpening,
    _anchorIndex: i,
  }));

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text || isNoiseLine(text)) continue;
    if (/opening balance/i.test(text) && rows[0]?.isOpeningBalance) {
      // handled as the row's own particulars below via anchor band
    }

    const anchor = findAnchorForLine(entry, anchorsByPage);
    if (!anchor) continue;
    const row = rows[anchors.indexOf(anchor)];
    if (!row) continue;

    if (/opening balance/i.test(text) && row.isOpeningBalance) {
      row.particularsParts.push("Opening Balance");
    }

    const txnDate = extractDateAt(entry, layout.transactionDateX);
    const valDate = extractDateAt(entry, layout.valueDateX);
    if (txnDate && !row.transactionDate) row.transactionDate = toDate(txnDate);
    if (valDate && !row.valueDate) row.valueDate = toDate(valDate);

    const amounts = extractAmountsFromEntry(entry, layout);
    for (const amount of amounts) {
      if (amount.column === "debit") row.debit = amount.value;
      else if (amount.column === "credit") row.credit = amount.value;
      else row.balance = amount.value;
    }

    const chequeItem = (entry.items || []).find(
      (item) => layout.chequeX !== null && Math.abs(item.x - layout.chequeX) <= 60 && /^\d+$/.test(clean(item.text)),
    );
    if (chequeItem) row.chequeNo = clean(chequeItem.text);

    if (!isSerialLine(entry, layout) && !txnDate && !valDate && amounts.length === 0 && !chequeItem) {
      const description = extractDescriptionText(entry, layout);
      if (description) row.particularsParts.push(description);
    }
  }

  return rows.map((row, i) => ({
    serialNo: row.isOpeningBalance ? 0 : row.serialNo,
    transactionDate: row.transactionDate,
    valueDate: row.valueDate,
    particulars: row.isOpeningBalance ? "Opening Balance" : clean(row.particularsParts.join(" ")) || "TRANSACTION",
    chequeNo: row.chequeNo,
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
    isOpeningBalance: row.isOpeningBalance,
  }));
}

function reconcileBankOfBarodaWorldAppTransactions(rows) {
  const mismatches = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    if (row.balance === null || previous.balance === null) continue;

    const expected = roundMoney(previous.balance - (row.debit || 0) + (row.credit || 0));
    const actual = roundMoney(row.balance);
    if (Math.abs(expected - actual) > 0.02) {
      mismatches.push({
        serialNo: row.serialNo,
        particulars: row.particulars,
        previousBalance: previous.balance,
        debit: row.debit,
        credit: row.credit,
        expectedBalance: expected,
        actualBalance: actual,
        difference: roundMoney(actual - expected),
      });
    }
  }
  return mismatches;
}

// Adapts this parser's native row shape (transactionDate/valueDate/debit/credit) to the
// {date, particulars, chequeNo, withdrawal, deposit, balance} shape the rest of the
// pipeline (reconciliation, CSV/Excel export) expects from every bank parser.
function toStatementTransactions(rows) {
  return rows.map((row) => ({
    date: row.transactionDate || row.valueDate || null,
    valueDate: row.valueDate,
    particulars: row.particulars,
    chequeNo: row.chequeNo,
    withdrawal: row.debit,
    deposit: row.credit,
    balance: row.balance,
    serialNo: row.serialNo,
    isOpeningBalance: row.isOpeningBalance,
  }));
}

export {
  isBankOfBarodaWorldAppLayout,
  parseBankOfBarodaWorldAppTransactions,
  reconcileBankOfBarodaWorldAppTransactions,
  buildColumnLayout,
  toStatementTransactions,
};
