import { amountItems, clean, parseDate, roundMoney } from "./common.js";

// Tolerant of OCR.space's word-level reconstruction, which spaces out "IFSC:" and "(INR)" the
// same way it spaces out every other punctuation-adjacent token elsewhere in this codebase (see
// ocrTransactionReconstructor.js's tightenNarrationPunctuation for the same phenomenon on
// narration text) -- a PNB statement scanned instead of exported with a native text layer would
// otherwise never be detected as "pnb" at all, since the original tight-spacing-only regexes
// simply don't match "IFSC : PUNB..." / "Amount ( INR )".
function isPnbLayoutText(text) {
  return (
    /IFSC\s*:\s*PUNB/i.test(text) &&
    /Date\s+Instrument\s*ID\s+Amount\s*\(\s*INR\s*\)\s+Type\s+Balance\s+Remarks/i.test(text)
  );
}

function isPnbLayout(lines) {
  const text = lines
    .slice(0, 80)
    .map((line) => clean(line.text || line))
    .join("\n");

  return isPnbLayoutText(text);
}

function isRowStart(entry) {
  const items = entry.items || [];
  return (
    items.some((item) => /^\d{2}\/\d{2}\/\d{4}$/.test(clean(item.text)) && item.x < 80) &&
    items.some((item) => /^(CR|DR)$/i.test(clean(item.text)) && item.x > 210 && item.x < 260)
  );
}

function isNoise(text) {
  return (
    !text ||
    /^Date\s+Instrument ID\s+Amount/i.test(text) ||
    /^Date:\s+\d{2}\/\d{2}\/\d{4}/i.test(text) ||
    /^Branch Details$/i.test(text) ||
    /^Customer Details$/i.test(text) ||
    /^(Branch Name|Branch Address|City|Pin|IFSC|MICR Code|Customer Name|Customer Address|CKYC Number|Nominee|Statement of Account)\b/i.test(
      text,
    )
  );
}

function isTerminalLine(text) {
  return (
    /^\*+\s*Generated through PNB ONE/i.test(text) ||
    /^Unless constituent/i.test(text) ||
    /^Computer generated entries/i.test(text) ||
    /^Please do not accept/i.test(text) ||
    /^Please ensure/i.test(text) ||
    /^Customers are requested/i.test(text) ||
    /^Please maintain/i.test(text) ||
    /^Please note Penal/i.test(text) ||
    /^Abbreviations are as under/i.test(text) ||
    /^(BR:|QAB:|Ret:|SALE$)/i.test(text)
  );
}

function detectColumns(lines) {
  for (const entry of lines.slice(0, 80)) {
    const text = clean(entry.text || entry);
    if (!/Date\s+Instrument ID\s+Amount\(INR\)\s+Type\s+Balance\s+Remarks/i.test(text)) {
      continue;
    }

    const findX = (pattern) => {
      const item = (entry.items || []).find((candidate) => pattern.test(clean(candidate.text)));
      return item ? item.x : null;
    };

    const balance = findX(/^Balance$/i) ?? 283;
    const remarks = findX(/^Remarks$/i) ?? 346;

    return {
      date: findX(/^Date$/i) ?? 43,
      amount: findX(/^Amount\(INR\)$/i) ?? 185,
      type: findX(/^Type$/i) ?? 234,
      balance,
      remarks: Math.min(remarks, balance + 65),
    };
  }

  return { date: 43, amount: 185, type: 234, balance: 283, remarks: 346 };
}

function parsePnbRow(entry, columns, sequence) {
  const items = [...(entry.items || [])].sort((left, right) => left.x - right.x);
  const dateItem = items.find((item) => /^\d{2}\/\d{2}\/\d{4}$/.test(clean(item.text)) && item.x < 80);
  const typeItem = items.find((item) => /^(CR|DR)$/i.test(clean(item.text)) && item.x > 210 && item.x < 260);
  const date = parseDate(dateItem?.text);
  const type = clean(typeItem?.text).toUpperCase();
  if (!date || !type) return null;

  const amounts = amountItems(items);
  const amountItem = amounts
    .filter((item) => item.x > columns.amount - 20 && item.x < columns.type - 5)
    .sort((left, right) => Math.abs(left.x - columns.amount) - Math.abs(right.x - columns.amount))[0];
  const balanceItem = amounts
    .filter((item) => item !== amountItem && item.x > columns.balance - 20)
    .sort((left, right) => Math.abs(left.x - columns.balance) - Math.abs(right.x - columns.balance))[0];

  if (!amountItem || !balanceItem) return null;

  const remarks = clean(
    items
      .filter((item) => {
        const text = clean(item.text);
        if (!text) return false;
        if (item === dateItem || item === typeItem || item === amountItem || item === balanceItem) return false;
        return item.x >= columns.remarks - 12;
      })
      .map((item) => item.text)
      .join(" "),
  );

  const amount = Math.abs(amountItem.value);

  return {
    sequence,
    date,
    particulars: remarks || "TRANSACTION",
    chequeNo: null,
    withdrawal: type === "DR" ? amount : null,
    deposit: type === "CR" ? amount : null,
    balance: roundMoney(balanceItem.value),
    type,
  };
}

function appendContinuation(row, line) {
  const text = clean(line);
  if (!text || isNoise(text) || isTerminalLine(text)) return;
  row.particulars = clean(`${row.particulars} ${text}`);
}

function parsePnbTransactions(lines) {
  const columns = detectColumns(lines);
  const transactions = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (isRowStart(entry)) {
      const row = parsePnbRow(entry, columns, transactions.length + 1);
      if (!row) continue;
      transactions.push(row);
      current = row;
      continue;
    }

    if (current && isTerminalLine(text)) {
      current = null;
      continue;
    }

    if (!current || isNoise(text)) continue;
    appendContinuation(current, text);
  }

  return transactions.map((row) => {
    // `type` is this row's own printed Type column ("CR"/"DR") -- the same value withdrawal/deposit
    // was derived from, not a guess -- and belongs on the exported transaction the same way it does
    // for every other format's own printed Cr/Dr indicator; only `sequence` (an internal counter) is
    // dropped here.
    const { sequence, ...transaction } = row;
    return transaction;
  });
}

export { isPnbLayout, isPnbLayoutText, parsePnbTransactions };
