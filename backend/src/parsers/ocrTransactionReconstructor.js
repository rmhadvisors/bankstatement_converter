import { clean, parseDate, roundMoney } from "./parsers/common.js";
import { correctOcrText } from "./ocrCorrections.js";

// Shared, layout-agnostic engine for turning OCR'd lines of a scanned bank statement into
// transactions. It intentionally does NOT rely on word bounding-box x-coordinates: those are
// only as reliable as the OCR engine's line clustering, and on a noisy/skewed scan a single
// misclustered line (e.g. a transaction's value-date landing on its own visual line instead of
// next to its transaction date) can cascade into merging several unrelated transactions into one
// row. Instead, a new transaction starts whenever a *line* begins with a recognizable date --
// everything after it is accumulated as that transaction's content until the next date-leading
// line (or a header/footer/terminal line) appears. This is far more tolerant of imperfect line
// clustering because it only ever needs one date, not a specific pair of items on one line.

const DATE_LINE_START = /^\s*(\d{2})[/.-](\d{2})[/.-](\d{2,4})\b/;
const DATE_ANYWHERE = /\b\d{2}[/.-]\d{2}[/.-]\d{2,4}\b/g;
const AMOUNT_REGEX = /-?\d+(?:,\d{2,3})*\.\d{1,2}/g;

// OCR.space's word-level reconstruction (see ocrLineReconstructor.js) always joins adjacent words
// with a single space, including a date's own digit/separator tokens when the OCR engine read
// them as separate words -- "28-03-2026" comes back as "28 - 03 - 2026". Left alone, that silently
// fails DATE_LINE_START/DATE_ANYWHERE (neither tolerates internal spaces) and the whole line looks
// like it has no date at all. Collapsing this narrowly (exactly DD-DD-DDDD digit groups) before
// any date matching happens is what keeps the rest of this file's date-boundary logic working
// regardless of which spacing convention a given OCR pass happened to produce.
function normalizeSpacedDates(text) {
  return text.replace(/(\d{2})\s*([/.-])\s*(\d{2})\s*([/.-])\s*(\d{2,4})/g, "$1$2$3$4$5");
}

// On a photographed/scanned "General Ledger Date" column that's an underlined hyperlink (as this
// Finacle screen's date column is), OCR.space's row-clustering can read that column's date as its
// own visual line, offset from the row's own Value Date/amount/narrative content by roughly a full
// row height -- real example, same logical row: line "16 - 01 -" (the General Ledger Date column,
// alone, missing its own year) immediately followed by "16 - 01 - 2026 5,00,000.00 Cr ... BALAJI
// ENTERPRISES" (Value Date onward, complete on its own). The leading fragment carries no
// information the following line doesn't already have -- every row in this layout prints the same
// date twice (General Ledger Date == Value Date) -- so it's pure noise, but appended to whichever
// block happens to be open (or misread as a date boundary once normalized) it corrupts either the
// previous row's particulars or the next row's own date. Dropping both this fragment shape and a
// lone stray year (the same column's year sometimes lands on a third line by itself) before block
// boundaries are ever decided is what keeps every other row's boundary detection unaffected by it.
//
// The trailing part is deliberately allowed to be 0 OR 1 digits, not just 0: a real sample had
// this exact fragment come back as "04 - 02 - 1" -- the year not dropped outright but cut down to
// a single stray digit. That's too short to be a real year (every real year here is 4 digits) so
// it can't collide with a genuine date, but it also doesn't match a bare trailing-separator ending
// -- left unhandled, that lone "1" isn't a date-boundary opener either (DATE_LINE_START needs an
// unspaced, real date) and gets silently appended into whatever narration is open instead.
const BARE_DATE_FRAGMENT = /^\s*\d{2}\s*[/.-]\s*\d{2}\s*[/.-]\s*\d{0,1}\s*$/;
const BARE_YEAR_FRAGMENT = /^\s*(?:19|20)\d{2}\s*$/;

function isDateColumnNoise(text) {
  return BARE_DATE_FRAGMENT.test(text) || BARE_YEAR_FRAGMENT.test(text);
}

const GENERIC_HEADER_FOOTER_PATTERNS = [
  /Transaction\s+Inquiry/i,
  /Page\s+\d+\s+of\s+\d+/i,
  /Branch\s+Name/i,
  /Account\s+Number/i,
  /Customer\s+ID/i,
  /^Opening\s+Balance\b/i,
  /^Closing\s+Balance\b/i,
  /Generated\s+On/i,
  /Statement\s+Period/i,
];

function isHeaderFooterLine(text, extraPatterns) {
  return GENERIC_HEADER_FOOTER_PATTERNS.some((pattern) => pattern.test(text)) || extraPatterns.some((pattern) => pattern.test(text));
}

// Groups the statement's OCR lines into one array of raw line-strings per transaction: every
// line whose *start* matches a date closes the previous block and opens a new one; every other
// line (until the next date-leading line, a header/footer line, or a terminal line) is appended
// to whichever block is currently open. Header/footer lines are dropped entirely -- they never
// start a block and never get appended into one. A terminal line (e.g. "Statement Summary",
// the OCR'd "OK" button on the last page) ends processing altogether, since everything after it
// is trailing chrome, not transactions.
// The transaction table's own column-header row always names its last column "Narrative" (or,
// generically, this is the one word that shows up nowhere in an account-info block above the
// table but always in the header row immediately preceding the first real transaction). Used only
// to scope prelude-buffering below to the table body -- never to the whole page -- so a dropped
// pre-block line can only ever be recovered content from *this* table, not leftover account-info
// text that legitimately has nowhere to attach.
const TABLE_BODY_STARTED_MARKER = /Narrative\b/i;

function groupIntoBlocks(lines, { headerFooterPatterns = [], terminalPatterns = [] } = {}) {
  const blocks = [];
  let current = null;
  let inTableBody = false;
  // Content that arrives before any block has opened, but after the table's own header row, used
  // to be silently dropped -- normally harmless, but on a statement whose very first transaction
  // row has its date-column hyperlink split onto its own line (the same artifact isDateColumnNoise
  // filters elsewhere), the row's own balance/narrative can be exactly this kind of orphaned
  // pre-block content. Buffering it and appending it after the block's opening line (not before --
  // prepending would put a narrative-embedded date ahead of the real one and get it mistaken for
  // the transaction date) recovers that first row instead of losing it.
  let prelude = [];

  for (const line of lines) {
    const rawText = normalizeSpacedDates(clean(line.text || line));
    if (!rawText) continue;
    // Correct OCR digit lookalikes before the boundary check, not after: a garbled leading date
    // like "16-03-2O26" must still be recognized as a transaction boundary, otherwise everything
    // from that row onward silently merges into whatever block came before it.
    const { text, hadCorrections } = correctOcrText(rawText);
    if (terminalPatterns.some((pattern) => pattern.test(text))) break;
    // The marker line itself is the table's own (possibly OCR-jumbled) column-header row, not
    // real content -- e.g. this line's actual OCR text can come back as "Date Date No . Amt .
    // Deposit Amt . Balance Narrative", which doesn't match any of the exact-phrase header
    // patterns below (those assume a cleaner join), so without this it would otherwise be the
    // first thing prelude buffers instead of being dropped.
    if (TABLE_BODY_STARTED_MARKER.test(text)) {
      inTableBody = true;
      continue;
    }
    if (isHeaderFooterLine(text, headerFooterPatterns)) continue;
    if (isDateColumnNoise(text)) continue;

    if (DATE_LINE_START.test(text)) {
      if (current) blocks.push(current);
      current = { lines: [text, ...prelude], hadCorrections };
      prelude = [];
      continue;
    }

    if (current) {
      current.lines.push(text);
      current.hadCorrections = current.hadCorrections || hadCorrections;
    } else if (inTableBody) {
      prelude.push(text);
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

function extractAmounts(text) {
  const amounts = [];
  for (const match of text.matchAll(AMOUNT_REGEX)) {
    const value = Number(match[0].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const suffixMatch = text.slice(match.index + match[0].length, match.index + match[0].length + 5).match(/^\s*(Cr|Dr)\b/i);
    amounts.push({
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length + (suffixMatch ? suffixMatch[0].length : 0),
      type: suffixMatch ? suffixMatch[1].toUpperCase() : null,
      value: Math.abs(value),
    });
  }
  return amounts;
}

function extractDates(text) {
  const dates = [];
  for (const match of text.matchAll(DATE_ANYWHERE)) {
    dates.push({ raw: match[0], start: match.index, end: match.index + match[0].length });
  }
  return dates;
}

// Removes a set of already-extracted [start, end) spans from text (used to strip out the
// recognized date and amount tokens before whatever's left is treated as narration/reference).
function removeSpans(text, spans) {
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  let result = "";
  let cursor = 0;
  for (const span of sorted) {
    result += text.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  result += text.slice(cursor);
  return result;
}

// OCR.space's word-level line reconstruction (ocrLineReconstructor.js) tokenizes a hyphen or
// slash that sits tight against its neighbors in the actual scan (e.g. "NEFT-MAHG0005631-
// PADMARAM") as its own separate "word" and joins every word with a single space regardless of
// how tight they were in the source -- inserting spacing that was never in the source PDF and can
// break reconciliation matching against other systems that expect the un-spaced form. Collapse it
// back only around a lone "-"/"/" (multi-character words keep whatever spacing they already had).
function tightenNarrationPunctuation(text) {
  return text.replace(/\s*([/-])\s*/g, "$1");
}

// Builds one transaction from already date-stripped-eligible text, given the amounts already
// extracted from it (exactly 1 or 2 -- callers are responsible for that check). Shared between
// the normal single-block path and the auto-resegmentation path below, so both produce
// identically-shaped transactions.
function buildTransaction(text, amounts, { txnDate, valueDate, dateSpans, hadCorrections }) {
  // Balance is conventionally the right-most (last-occurring) amount on the row, with narration
  // following it; when there's only one amount, treat it as the balance with no debit/credit
  // (e.g. a balance-carry line that got attached to this block without its own transaction amount).
  const balanceAmount = amounts[amounts.length - 1];
  const transactionAmount = amounts.length === 2 ? amounts[0] : null;
  const isDebit = transactionAmount?.type === "DR";

  // The Instrument No. column, in the real table, sits strictly between the date column(s) and
  // the first amount column -- never inside the narration. Only that narrow slice of text is
  // considered for a reference/cheque number, and only when it consists of *nothing but* a bare
  // run of digits. This is deliberately narrower than "any standalone number anywhere in the
  // row": narrations routinely contain their own incidental digit runs after the amounts (e.g.
  // "BY CLG 000012 viaks", a reference number that's part of the narration text itself), and
  // those must stay in the description rather than being mistaken for the instrument column.
  const maxDateEnd = dateSpans.length ? Math.max(...dateSpans.map((span) => span.end)) : 0;
  const firstAmountStart = amounts[0].start;
  const betweenDateAndAmount = clean(text.slice(maxDateEnd, firstAmountStart));
  const chequeNo = /^\d{4,}$/.test(betweenDateAndAmount) ? betweenDateAndAmount : null;

  const spansToStrip = [...dateSpans, ...amounts];
  if (chequeNo) spansToStrip.push({ start: maxDateEnd, end: firstAmountStart });
  // A lone leading "." can survive span-stripping on its own (e.g. a stray character the OCR pass
  // left behind right after a "Cr"/"Dr" suffix, outside that suffix's own matched span) -- it
  // carries no narration content of its own, so it's dropped rather than left as noise.
  const remainder = tightenNarrationPunctuation(clean(removeSpans(text, spansToStrip))).replace(/^\.\s*/, "");

  return {
    date: txnDate,
    txnDate,
    valueDate,
    particulars: clean(remainder) || "TRANSACTION",
    chequeNo,
    // When Cr/Dr wasn't legible, default to crediting the amount; correctDebitCreditByBalance
    // (run over the whole transaction list afterwards) reassigns debit/credit from the actual
    // balance-to-balance delta, so this default only matters until that pass runs.
    withdrawal: transactionAmount && isDebit ? roundMoney(transactionAmount.value) : null,
    deposit: transactionAmount && !isDebit ? roundMoney(transactionAmount.value) : null,
    balance: roundMoney(balanceAmount.value),
    // The "Cr"/"Dr" printed directly next to THIS row's own balance -- not this transaction's own
    // debit/credit direction, which is a different, unrelated fact (a withdrawal row's own balance
    // can still be printed "Cr" whenever the account stays positive, as it does on every row of a
    // real sample statement). Defaults to CR only when that suffix wasn't legible at all, for the
    // same reason the debit/credit default above does.
    type: balanceAmount.type || "CR",
    hadOcrCorrections: hadCorrections,
  };
}

// A block normally ends up with exactly one transaction amount and one balance. More than two
// numeric values means two transactions' worth of amount data ended up in the same date-block --
// most commonly because the second transaction's own row had no legible leading date and so
// never opened its own block. Rather than exporting a garbled row or giving up immediately, try
// to split the block's *physical* OCR lines back into consecutive groups that each resolve to a
// clean 1-or-2-amount transaction, all sharing the one date this block did find. If any resulting
// group still doesn't resolve cleanly, the whole split is abandoned (caller falls back to review).
function trySplitByAmounts(block, txnDate, valueDate) {
  const groups = [];
  let current = [];
  let currentAmountCount = 0;

  for (const line of block.lines) {
    const lineAmountCount = extractAmounts(line).length;
    if (currentAmountCount >= 2 && lineAmountCount > 0) {
      groups.push(current);
      current = [];
      currentAmountCount = 0;
    }
    current.push(line);
    currentAmountCount += lineAmountCount;
  }
  if (current.length > 0) groups.push(current);

  if (groups.length < 2) return null;

  const transactions = [];
  for (const groupLines of groups) {
    const groupText = clean(groupLines.join(" "));
    const amounts = extractAmounts(groupText);
    if (amounts.length === 0 || amounts.length > 2) return null;

    // Strip the shared transaction/value date text if this particular line group happens to
    // *start with* it (normally only the first group does) -- restricted to a genuinely leading
    // date (plus an adjacent value date) rather than every date-shaped token anywhere in the
    // group. A group built from an amount-first line (e.g. a General-Ledger-Date-hyperlink
    // artifact left this group's own date on a separate physical line entirely, so the group text
    // starts with its amount instead) can still legitimately contain OTHER dates further in --
    // most commonly an interest narration's own date range ("Int.:23-03-2025 To 28-06-2025").
    // Treating every date anywhere as a column to strip silently deleted that entire range instead
    // of leaving it as narration text.
    const groupDates = extractDates(groupText);
    const leadingGroupDate = groupDates[0] && groupDates[0].start === 0 ? groupDates[0] : null;
    const adjacentGroupValueDate =
      leadingGroupDate && groupDates[1] && groupDates[1].start - leadingGroupDate.end < 15 ? groupDates[1] : null;
    const dateSpansInGroup = [leadingGroupDate, adjacentGroupValueDate].filter(Boolean);
    transactions.push(
      buildTransaction(groupText, amounts, {
        txnDate,
        valueDate,
        dateSpans: dateSpansInGroup,
        hadCorrections: block.hadCorrections,
      }),
    );
  }

  return transactions;
}

function reconstructBlock(block) {
  // Lines are already OCR-corrected (see groupIntoBlocks); joining and correcting again here is
  // a no-op for those, but also catches any lookalike run that only becomes recognizable once
  // adjacent lines are joined (e.g. a decimal split across a line break).
  const joined = clean(block.lines.join(" "));
  const { text, hadCorrections: joinCorrections } = correctOcrText(joined);
  const hadCorrections = block.hadCorrections || joinCorrections;

  const dates = extractDates(text);
  if (dates.length === 0) {
    return { error: "No transaction date could be found in this block.", rawText: joined };
  }

  const txnDate = parseDate(dates[0].raw);
  if (!txnDate || Number.isNaN(txnDate.getTime())) {
    return { error: `Date "${dates[0].raw}" is not a valid calendar date.`, rawText: joined };
  }

  // A second date immediately after the first (a few characters of separator at most) is the
  // value date column; a date found much later in the block is narration content (e.g. an
  // interest-period note like "Int.:28-12-2025 To 28-03-2026") and must not be mistaken for it.
  const valueDateMatch = dates[1] && dates[1].start - dates[0].end < 15 ? dates[1] : null;
  const valueDate = valueDateMatch ? parseDate(valueDateMatch.raw) : null;

  const dateSpans = [dates[0], ...(valueDateMatch ? [valueDateMatch] : [])];
  const amounts = extractAmounts(text);

  if (amounts.length === 0) {
    return { error: "No debit, credit, or balance amount could be found in this block.", rawText: joined, txnDate, valueDate };
  }

  if (amounts.length > 2) {
    const split = trySplitByAmounts(block, txnDate, valueDate);
    if (split) return { transactions: split };

    return {
      error: `Expected a single amount and a balance but found ${amounts.length} numeric values; automatic re-segmentation could not separate them into clean transactions.`,
      rawText: joined,
      txnDate,
      valueDate,
    };
  }

  return { transactions: [buildTransaction(text, amounts, { txnDate, valueDate, dateSpans, hadCorrections })] };
}

// On this kind of scan, a row whose "General Ledger Date" column got OCR'd as a hyperlink can end
// up with its content (amount/narrative, no leading date of its own) silently appended to the
// *previous* row's block instead of opening its own -- and the row's date, printed again further
// down, lands on its own now-content-less line right after. Two symptoms of the exact same cause:
// the previous block ends up needing trySplitByAmounts (more amounts than one transaction has),
// and a nearby block is a bare date with nothing else in it. When that pairing shows up, the
// split's last transaction almost certainly belongs to the orphan date, not the block it landed
// in -- reassigning it and dropping the (now fully explained) empty block is a lot more useful
// than flagging both as separate, disconnected review items.
//
// The orphan isn't always the *very next* block: two consecutive rows sharing the same date (a
// debit and a credit posted together, common at month/period boundaries) can sit between the
// split and its own orphan, since that pair's own block is entirely legitimate content, not noise
// to skip past blindly. A short bounded lookahead balances catching that case against ever
// grabbing some unrelated later date by coincidence.
const ORPHAN_LOOKAHEAD_WINDOW = 3;

function isOrphanDateBlock(result) {
  return Boolean(result.error) && /No debit, credit, or balance amount/.test(result.error) && result.txnDate;
}

// Returns { transactions, reviewRows } -- reviewRows holds blocks that looked like they started a
// transaction (had a leading date) but failed validation (no amount, too many amounts, an invalid
// date), kept for manual review instead of being force-fit into a transaction or silently dropped.
function reconstructTransactions(lines, options = {}) {
  const blocks = groupIntoBlocks(lines, options);
  const transactions = [];
  const reviewRows = [];
  const consumed = new Set();

  for (let index = 0; index < blocks.length; index += 1) {
    if (consumed.has(index)) continue;
    const result = reconstructBlock(blocks[index]);

    if (!result.error && result.transactions.length > 1) {
      let orphanIndex = -1;
      let orphanResult = null;
      for (let lookahead = index + 1; lookahead <= index + ORPHAN_LOOKAHEAD_WINDOW && lookahead < blocks.length; lookahead += 1) {
        const candidate = reconstructBlock(blocks[lookahead]);
        if (isOrphanDateBlock(candidate)) {
          orphanIndex = lookahead;
          orphanResult = candidate;
          break;
        }
      }

      if (orphanResult) {
        const last = result.transactions[result.transactions.length - 1];
        last.date = orphanResult.txnDate;
        last.txnDate = orphanResult.txnDate;
        last.valueDate = orphanResult.valueDate;
        transactions.push(...result.transactions);
        consumed.add(orphanIndex); // it carried no data of its own
        continue;
      }
    }

    if (result.error) {
      reviewRows.push({
        date: result.txnDate || null,
        valueDate: result.valueDate || null,
        particulars: result.rawText,
        chequeNo: null,
        withdrawal: null,
        deposit: null,
        balance: null,
        confidence: 0,
        reasons: [result.error],
      });
      continue;
    }
    transactions.push(...result.transactions);
  }

  return { transactions, reviewRows };
}

export { reconstructTransactions, groupIntoBlocks, extractAmounts, extractDates };
