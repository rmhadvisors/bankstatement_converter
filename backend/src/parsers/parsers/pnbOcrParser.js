import { clean, parseDate, roundMoney, isChronological } from "./common.js";

// pnbParser.js's parsePnbTransactions assumes a clean native PDF text layer with real word
// x-coordinates it can use to find each row's Date/Instrument ID/Amount/Type/Balance/Remarks
// columns. A scanned PNB statement (no embedded text layer at all, this app's own OCR.space pass
// used instead) has no such coordinates -- OCR.space reports word positions in image pixel space,
// which don't line up with those column boundaries at all. This is a second, tolerant engine for
// exactly that case: date-leading-line block reconstruction (same shape as
// ocrTransactionReconstructor.js's Finacle engine), but matched against PNB's own
// "Date Instrument-ID Amount Type Balance Remarks" column order and CR/DR-as-transaction-direction
// semantics, which are different enough from that engine's assumptions (Cr/Dr as a *balance*
// suffix, not this row's own debit/credit) that reusing it directly would misread this row shape.

const AMOUNT_PATTERN = "\\d+(?:,\\d{2,3})*\\.\\d{1,2}";
const ROW_REGEX = new RegExp(
  `^(\\d{2}/\\d{2}/\\d{4})\\s+(?:(\\d{4,})\\s+)?(${AMOUNT_PATTERN})\\s+(CR|DR)\\s+(${AMOUNT_PATTERN})\\s*(.*)$`,
  "i",
);

// "31 / 03 / 2026" -> "31/03/2026". Deliberately narrow (exactly DD-DD-DDDD digit groups either
// side of the slashes) so it can't accidentally collapse spacing inside an unrelated number, and
// applied per-line (before block grouping) so the date-leading-line boundary check below can find
// it regardless of how OCR.space happened to space this particular line's date out.
function normalizeSpacedDates(text) {
  return text.replace(/(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})/g, "$1/$2/$3");
}

const DATE_LINE_START = /^\d{2}\/\d{2}\/\d{4}\b/;

// OCR.space's word-level line reconstruction tokenizes a "/" or "-" that's tight against its
// neighbors in the actual scan (e.g. "UPI/DR/609090111450/SARALA", "Int.Pd:01-12-2025") as its own
// separate "word" and joins every word with a single space regardless, inserting spacing that was
// never in the source PDF (the exact phenomenon ocrTransactionReconstructor.js's
// tightenNarrationPunctuation already documents and fixes for the Finacle path). Applied to the
// whole row here -- both the date and the remarks use "/" the same way, so one pass over the fully
// joined row text handles both instead of needing separate date- and remarks-specific fixes.
function tightenSlashDashSpacing(text) {
  return text.replace(/\s*([/-])\s*/g, "$1");
}

function isPnbOcrLayoutText(text) {
  return (
    /IFSC\s*:\s*PUNB/i.test(text) &&
    /Date\s+Instrument\s*ID\s+Amount\s*\(\s*INR\s*\)\s+Type\s+Balance\s+Remarks/i.test(text)
  );
}

const HEADER_FOOTER_PATTERNS = [
  /^Date\s+Instrument/i,
  /^Date\s*:\s*\d{2}\/\d{2}\/\d{4}/i, // mid-statement "Date: DD/MM/YYYY HH:MM:SS Page N" footer
  /^Branch Details$/i,
  /^Customer Details$/i,
  /^(Branch Name|Branch Address|City|Pin|IFSC|MICR Code|Customer Name|Customer Address|CKYC Number|Nominee)\b/i,
  /^Statement of Account\b/i,
  /^punjab national bank$/i,
  /the name you can BANK upon/i,
  // OCR noise from the bank logo's own tagline ("...bharose ka prateek!"), never real content.
  /wehe am Retas/i,
];

const TERMINAL_PATTERNS = [
  /^\*+\s*Generated through PNB ONE/i,
  /^Unless constituent/i,
  /^Computer generated entries/i,
  /^Please do not accept/i,
  /^Please ensure/i,
  /^Customers are requested/i,
  /^Please maintain/i,
  /^Please note Penal/i,
  /^Abbreviations are as under/i,
];

function isHeaderFooterLine(text) {
  return HEADER_FOOTER_PATTERNS.some((pattern) => pattern.test(text));
}

function isTerminalLine(text) {
  return TERMINAL_PATTERNS.some((pattern) => pattern.test(text));
}

// Groups OCR lines into one array of raw line-strings per transaction row: a line whose *start*
// is a date opens a new block; every other line (remarks that wrapped onto their own line, or
// landed on a line by themselves entirely -- both real shapes seen in this layout) is appended to
// whichever block is open, until the next date-leading line or a terminal line ends things.
function groupIntoBlocks(lines) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const text = normalizeSpacedDates(clean(line.text || line));
    if (!text) continue;
    if (isTerminalLine(text)) break;
    if (isHeaderFooterLine(text)) continue;

    if (DATE_LINE_START.test(text)) {
      if (current) blocks.push(current);
      current = [text];
      continue;
    }

    if (current) current.push(text);
  }
  if (current) blocks.push(current);

  return blocks;
}

function parsePnbOcrTransactions(lines) {
  const blocks = groupIntoBlocks(lines);
  const transactions = [];
  const reviewRows = [];

  for (const block of blocks) {
    const text = tightenSlashDashSpacing(clean(block.join(" ")));
    const match = text.match(ROW_REGEX);
    if (!match) {
      reviewRows.push({
        date: null,
        particulars: text,
        chequeNo: null,
        withdrawal: null,
        deposit: null,
        balance: null,
        confidence: 0,
        reasons: ["Row did not match the expected PNB Date/Instrument-ID/Amount/Type/Balance/Remarks shape."],
      });
      continue;
    }

    const [, dateRaw, instrumentId, amountRaw, typeRaw, balanceRaw, remarks] = match;
    const date = parseDate(dateRaw);
    if (!date || Number.isNaN(date.getTime())) {
      reviewRows.push({
        date: null,
        particulars: text,
        chequeNo: null,
        withdrawal: null,
        deposit: null,
        balance: null,
        confidence: 0,
        reasons: [`Date "${dateRaw}" is not a valid calendar date.`],
      });
      continue;
    }

    const type = typeRaw.toUpperCase();
    const amount = roundMoney(Number(amountRaw.replace(/,/g, "")));
    const balance = roundMoney(Number(balanceRaw.replace(/,/g, "")));

    transactions.push({
      date,
      particulars: clean(remarks) || "TRANSACTION",
      chequeNo: instrumentId || null,
      withdrawal: type === "DR" ? amount : null,
      deposit: type === "CR" ? amount : null,
      balance,
      // This row's own printed Type -- PNB's Type column states this transaction's own
      // debit/credit direction directly (unlike Finacle/Federal's Type, which describes the
      // balance's own Cr/Dr suffix), so it's read verbatim rather than re-derived from
      // withdrawal/deposit even though the two agree here by construction.
      type,
    });
  }

  // This statement prints newest-first (31-03-2026 leads, 07-04-2025 trails); the exported sheet
  // reads oldest-first like every other format here, so it's reversed unless it's already the
  // other order for some reason.
  const ordered = isChronological(transactions) ? transactions : [...transactions].reverse();

  return { transactions: ordered, reviewRows };
}

export { isPnbOcrLayoutText, parsePnbOcrTransactions };
