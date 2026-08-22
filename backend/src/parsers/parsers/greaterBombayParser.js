import { clean, parseDate, roundMoney } from "./common.js";

// The Greater Bombay Co-operative Bank has no native-text-layer statement in this project yet --
// every file from it is a phone-camera photo of a printed statement, OCR'd. Phone photos (as
// opposed to a flatbed scan) bring their own recurring failure modes on top of ordinary OCR noise:
// skew, partial finger obstruction, uneven lighting, JPEG artifacts, and multi-page statements
// arriving as separate photos with no shared header. Every normalization/detection rule below is
// built against the *vocabulary* of this bank's fixed statement layout (its handful of transaction
// type codes, its opening-balance line, its column header, its footer shape) rather than against
// any one sample's specific OCR garbling, so a new, never-seen photo in this same layout is
// expected to route and parse correctly without a new per-file fix. Where that wasn't achievable
// generically, it's called out in a comment at the point it happens, not silently narrowed.

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[rows - 1][cols - 1];
}

const DATE = "\\d{2}\\s*/\\s*\\d{2}\\s*/\\s*\\d{2,4}";
const AMOUNT = "\\d[\\d,]*\\.\\d{2}";
// Neither date blob is required to be a strictly valid DD/DD/DD date to *open* a block -- real
// samples have shown either one individually mangled beyond a clean read (one OCR'd "01/07/26" as
// "01707 / 26", losing a slash entirely; another sample lost it on the *second* date instead, while
// the first stayed clean). Requiring both, or a fixed one of the two, to be strictly valid up front
// silently dropped the entire row -- never opened a block at all, so its narration lines were lost
// too, with nothing open to append them to. LOOSE_DATE only commits to "digit groups with at least
// one slash somewhere" -- loose enough to tolerate a merged/dropped digit group, but the slash
// requirement still keeps an ordinary reference-number line ("0093123042928 something") from itself
// looking like a row-start. Each blob is bounded (1-6 digits per group, 1-2 slashes) rather than
// unbounded, so this can't be pushed toward pathological backtracking on a long line with lots of
// digit/slash/space runs -- a real risk once this same regex started running, via
// isGreaterBombayContinuationText below, against *every* document's text during format detection,
// not just ones already confirmed to be this bank's.
const LOOSE_DATE = "\\d{1,6}(?:\\s*/\\s*\\d{1,6}){1,2}";
const ROW_START = new RegExp(`^(${LOOSE_DATE})\\s+(${LOOSE_DATE})\\s+([A-Za-z].*)$`);

// Strict validation of a date blob, used only once ROW_START has already found the row shape --
// unlike LOOSE_DATE, this requires the clean DD/DD/DD form exactly, so a garbled blob
// ("01707 / 26") is correctly rejected here rather than mis-parsed into a wrong date. Which of the
// two blobs (if either) is actually valid is resolved in parseBlock.
function parseLooseDate(blob) {
  const match = clean(blob).match(new RegExp(`^(${DATE})$`));
  return match ? parseDate(match[1]) : null;
}

// "01 / 07 / 26" -> "01/07/26". OCR routinely spaces the slashes out; collapsed once up front so
// every other regex here can assume tight "DD/DD/DD" spacing. (Spaced-out digit groups *within* an
// amount, e.g. "12 196.72", are deliberately not collapsed the same way: unlike a date, an amount's
// internal spacing can't be told apart from the whitespace between two *separate* numbers on the
// same line -- e.g. "2000.00 342566.54" would collapse into the single wrong number
// "2000.00342566.54" -- so that class of noise isn't safely fixable by a blind regex and isn't
// attempted here.)
function normalizeSpacedDates(text) {
  return text.replace(/(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{2,4})/g, "$1/$2/$3");
}

// A real sample OCR'd a balance's decimal point as a comma ("342566,54" for "342566.54"). Scoped to
// a single row's own amount/balance text (never applied to header/footer numbers, which use real
// Indian comma-grouping, e.g. "9,30,953.90") so it can't be confused with a thousands separator:
// this bank's own row-level amounts and balances never print comma-grouped in this OCR's output, so
// a comma directly followed by exactly two digits and then a non-digit is unambiguous here.
function fixCommaDecimal(text) {
  return text.replace(/(\d),(\d{2})(?!\d)/g, "$1.$2");
}

function fuzzyIncludesWord(text, canonical) {
  const tokens = text.toUpperCase().match(/[A-Z]+/g) || [];
  const maxDistance = canonical.length <= 3 ? 1 : 2;
  return tokens.some(
    (token) => Math.abs(token.length - canonical.length) <= 2 && levenshtein(token, canonical) <= maxDistance,
  );
}

function fuzzyIncludesAll(text, canonicals) {
  return canonicals.every((word) => fuzzyIncludesWord(text, word));
}

function fuzzyCountMatches(text, canonicals) {
  return canonicals.filter((word) => fuzzyIncludesWord(text, word)).length;
}

const HEADER_FOOTER_PATTERNS = [
  /^GREATER BANK$/i,
  /^Page Number/i,
  /^THE GREATER BOMBAY CO\s*-?\s*OP BANK$/i,
  /Your Branch\s*:/i,
  /^Account No\s*:/i,
  /^Product\b/i,
  /^Cleared Balance\b/i,
  /^IFSC\s*:?\s*GBCB/i,
  /^MICR Code\b/i,
  /^Statement of Account\b/i,
  /^Drawing Power\b/i,
  /^Post Date\s+Value Date\s+Details\b/i,
];

// The footer prints a totals-table header ("Ope Bal | Dr count | Cr count | Debits | Credits | Clo
// Bal") -- "Debits" and "Credits" are the two words that survive OCR most reliably in it (longer,
// less visually ambiguous than "Ope Bal"/"Clo Bal"/"count"), so fuzzy-matching on just those two is
// the generic detector rather than a literal copy of the whole header string; it naturally tolerates
// spelling drift like "Ope Ball" (an extra L) without a special case for that one variant.
function isFooterTotalsHeaderLine(text) {
  return fuzzyIncludesAll(text, ["DEBITS", "CREDITS"]);
}

// This bank's own page-boundary legal disclaimer ("In Case Your Account Is Operated By A Letter Of
// Attorney Holder, Please Check The Transaction With Extra Care") OCRs so badly its own leading
// words are frequently unrecognizable ("Case Your Age 18 OperaTS / ... gider ,"). Rather than
// matching this one bank's exact wording, this is caught two ways, both generic: (1) a line that
// scores at least 2 fuzzy hits against a small set of common bank-disclaimer words survives even
// when the rest of the line is badly garbled or the wording differs from this one sample; (2) any
// unusually long line with no "@" (every genuine narration line in this format -- a UPI handle, a
// reference number -- is short, under ~40 characters) is disclaimer/footer prose by shape alone,
// which also catches disclaimer wording never seen in any sample so far. Without either check, this
// text gets appended as narration onto whichever transaction happens to be last before the page
// break -- a real observed bug, not hypothetical. The word list itself is the one piece of this
// file that's still an enumerated vocabulary rather than a fully derived rule: legal boilerplate
// wording is bank-specific and can't be inferred from statement structure the way transaction type
// codes can, so a genuinely novel disclaimer using none of these words and short enough to dodge the
// length check would still slip through -- flagged here rather than silently assumed solved.
const DISCLAIMER_VOCAB = [
  "PLEASE",
  "CHECK",
  "TRANSACTION",
  "EXTRA",
  "CARE",
  "OPERATED",
  "ATTORNEY",
  "HOLDER",
  "LETTER",
];

function isDisclaimerLine(text) {
  if (text.length > 90 && !text.includes("@")) return true;
  return fuzzyCountMatches(text, DISCLAIMER_VOCAB) >= 2;
}

function isHeaderFooterLine(text) {
  return HEADER_FOOTER_PATTERNS.some((pattern) => pattern.test(text)) || isFooterTotalsHeaderLine(text);
}

function isTerminalLine(text) {
  return isFooterTotalsHeaderLine(text) || isDisclaimerLine(text);
}

// Every trigger here is structural to this bank's statement layout, never a value copied from one
// particular account's own statement: the IFSC prefix ("GBCB") is common to every branch of this
// bank -- only the letters are matched, never the digits after it, which are that branch's own code
// and differ statement to statement -- and the bank-name text, "BROUGHT FORWARD" opening-balance
// label, and column header row are all printed on every statement this bank issues, regardless of
// account, month, or branch.
//
// Combined as (bank identity) AND (layout structure) rather than requiring every one of these
// individually: a bank-identity signal (name text or IFSC prefix) confirms which bank this is, and
// a layout-structure signal (the opening-balance line or the full column header row) confirms it's
// this specific statement format -- either signal within each pair surviving a real OCR pass is
// enough, so one dropped line can't misroute a genuine Greater Bombay statement back into the
// generic fallback.
//
// Both signals are deliberately anchored, not bare substring/word checks, against two real
// collisions found while testing this against an unrelated bank's own statement: (1) "GBCB" can
// legitimately appear inside *any* bank's own UPI narration when a counterparty happens to hold a
// Greater Bombay account (a real sample statement contained "MAHESH/GBCB/9" as a payee reference,
// nothing to do with whose statement it was) -- requiring the "IFSC" label immediately before it,
// the way it's only ever printed in this bank's own header, rules that out. (2) "Date"/"Debit"/
// "Credit"/"Balance" are near-universal banking vocabulary that fuzzy-matches almost any statement's
// own column header -- requiring the literal adjacent phrases "Post Date", "Value Date", and "Chq
// no" (a specific, unusual three-column combination for this bank, not a generic word) instead of
// scattered single-word fuzzy hits keeps this a real layout signal rather than a near-universal one.
function isGreaterBombayLayoutText(text) {
  const hasBankName = /GREATER BANK/i.test(text) || /THE GREATER BOMBAY CO\s*-?\s*OP BANK/i.test(text);
  const hasIfscPrefix = /IFSC\s*:?\s*GBCB/i.test(text);
  const hasOpeningBalanceLine = /BROUGHT FORWARD/i.test(text);
  const hasColumnHeaderRow = /Post\s*Date/i.test(text) && /Value\s*Date/i.test(text) && /Chq\s*no/i.test(text);

  return (hasBankName || hasIfscPrefix) && (hasOpeningBalanceLine || hasColumnHeaderRow);
}

// A multi-page statement photographed page-by-page means later pages carry none of the bank-name/
// IFSC/column-header chrome isGreaterBombayLayoutText looks for -- just transaction rows. Detected
// instead by this format's own recurring row shape: at least 2 lines that both (a) lead with a
// Post-Date/Value-Date pair and (b) have a type code recognizable by matchTypeCode. Reusing
// matchTypeCode here (rather than a second, separately-maintained keyword list) means this detector
// and the parser that actually acts on it can never disagree about what counts as a transaction row.
//
// "TRF FR"/"TRF TO" is this bank's own reference-line phrasing, printed on every genuine
// transaction row in this format and unlikely to appear by coincidence in another bank's statement.
// Checked first, and cheaply (one plain regex over the whole text, no ambiguous quantifiers), so a
// document that's obviously not this bank never reaches the per-line fuzzy scan below -- that scan
// runs ROW_START plus matchTypeCode's several edit-distance comparisons per line, real cost this
// format-detection path shouldn't spend on every document, only ones already showing this bank's own
// fingerprint. (This wasn't just theoretical: an earlier cut of this ran the per-line scan
// unconditionally and made statement detection for an unrelated bank's large pipe-table PDF take
// minutes instead of a second.)
function hasTransferReferenceLine(lines) {
  return lines.some((line) => /\bTRF\s*(FR|TO)\b/i.test(normalizeSpacedDates(clean(line.text || line))));
}

// Distance <=1 here, tighter than matchTypeCode's own default <=2 used once a page is already known
// to be this bank's -- a looser fuzzy match is common enough to occasionally coincide with some
// other bank's own date-pair-leading row shape too, and misrouting a different bank's statement into
// this parser is worse than occasionally falling back to the generic parser on a very badly garbled
// continuation page.
function countRecognizableTransactionRows(lines) {
  let count = 0;
  for (const line of lines) {
    const text = normalizeSpacedDates(clean(line.text || line));
    const rowMatch = text.match(ROW_START);
    if (!rowMatch) continue;
    const typeCode = matchTypeCode(rowMatch[3]);
    if (typeCode && typeCode.distance <= 1) count += 1;
  }
  return count;
}

// Accepts either an already-split lines array or raw text with embedded newlines (mirroring
// detectBank's own text-or-lines flexibility) since detector.js only ever has whichever one the
// upstream extraction step produced.
function isGreaterBombayContinuationText(pdfTextOrLines) {
  const lines = Array.isArray(pdfTextOrLines) ? pdfTextOrLines : String(pdfTextOrLines || "").split(/\r?\n/);
  if (!hasTransferReferenceLine(lines)) return false;
  return countRecognizableTransactionRows(lines) >= 2;
}

function extractOpeningBalance(text) {
  // Allows a comma in place of the final decimal point here too (the same misread fixCommaDecimal
  // handles per-row), scoped safely because this capture is already anchored to one specific known
  // amount (whatever immediately follows "BROUGHT FORWARD") rather than scanned across the whole
  // statement, so it can't collide with an unrelated comma-grouped number elsewhere in the header.
  const match = normalizeSpacedDates(clean(text)).match(/BROUGHT\s*FORWARD\s*:?\s*(\d[\d,]*[.,]\d{2})\s*([A-Za-z]{1,3})/i);
  if (!match) return null;
  return Number(match[1].replace(/,(\d{2})$/, ".$1").replace(/,/g, ""));
}

// This bank re-prints "BROUGHT FORWARD <balance>" as every continuation page's own opening balance.
// On at least one real sample it landed glued onto the very next line's own date-leading transaction
// text (no line break between them), which meant the line failed to look like either "just the
// opening-balance restatement" or "a transaction row" and the whole line -- transaction included --
// got dropped as noise. Stripping this prefix off (and returning what, if anything, is left) fixes
// that: a bare "BROUGHT FORWARD ... Cr" with nothing else becomes "", correctly dropped further
// down; "BROUGHT FORWARD ... Cr 01/07/26 01/07/26 DEP TFR ..." becomes just the transaction text,
// which then flows through the normal row-start check.
const BROUGHT_FORWARD_PREFIX = /^BROUGHT\s*FORWARD\s*:?\s*\d[\d,]*[.,]\d{2}\s*[A-Za-z]{1,3}\s*/i;

function stripBroughtForwardPrefix(text) {
  const match = text.match(BROUGHT_FORWARD_PREFIX);
  return match ? text.slice(match[0].length).trim() : text;
}

// Type codes as printed, matched by whole-phrase edit distance against this bank's fixed vocabulary
// (never a hardcoded list of specific garbled spellings): each candidate's canonical words are
// joined into one compact string ("CASPRESCHQ") and compared, with internal whitespace stripped,
// against however many of the row's own leading words look like they could be this candidate. That
// makes both a straightforward letter substitution ("TER" for "TFR", "NDL"/"HDL"/"HOL" for "WDL",
// "DERI" for "DEP") *and* two code words OCR'd with no space between them ("PRESCHO" for "PRES
// CHQ", seen in a real sample) match the same way, since both are just edit-distance-1/2 away from
// the canonical compact string -- no per-variant entry needed for either failure mode. `direction`
// is only ever a first guess -- correctDebitCreditByBalance (run for every parser in parser.js) has
// the final say once it has both rows' balances.
const TYPE_CODE_DEFS = [
  { words: ["DEP", "TFR"], label: "DEP TFR", direction: "credit" },
  { words: ["WDL", "TFR"], label: "WDL TFR", direction: "debit" },
  { words: ["CAS", "PRES", "CHQ"], label: "CAS PRES CHQ", direction: "debit" },
  { words: ["BY", "TRANSFER"], label: "BY TRANSFER", direction: "credit" },
  { words: ["TO", "TRANSFER"], label: "TO TRANSFER", direction: "debit" },
];
// 3, not 2: real samples have shown *two* code words independently garbled on the same row at once
// ("DERI TER" for "DEP TFR", edit distance 3 as one compact string; "HOL TER" for "WDL TFR", also
// 3) -- distance 2 alone caught a single garbled word but not a compound corruption. Still safely
// clear of a genuine cross-candidate collision: the nearest two real candidates ("DEP TFR" misread
// so badly it could pass for "WDL TFR") sit at distance 4, a full point outside this threshold.
const TYPE_CODE_MAX_DISTANCE = 3;

function leadingWords(text, count) {
  const matches = [...text.matchAll(/\S+/g)];
  return matches.slice(0, count).map((m) => ({ word: m[0], end: m.index + m[0].length }));
}

// Tries consuming one fewer / exactly / one more whitespace-separated token than the candidate has
// canonical words, so a single code word OCR-merged into its neighbor ("PRESCHO") or OCR-split in
// two both still land within the same compact-string comparison as a clean read would.
function scoreCandidate(rest, candidate) {
  const canonicalCompact = candidate.words.join("");
  const tokenCounts = new Set([Math.max(1, candidate.words.length - 1), candidate.words.length, candidate.words.length + 1]);

  let best = null;
  for (const count of tokenCounts) {
    const words = leadingWords(rest, count);
    if (words.length < count) continue;
    const matchedText = rest.slice(0, words[words.length - 1].end);
    const compact = matchedText.replace(/\s+/g, "").toUpperCase();
    const distance = levenshtein(compact, canonicalCompact);
    if (distance <= TYPE_CODE_MAX_DISTANCE && (!best || distance < best.distance)) {
      best = { matchedText, distance };
    }
  }
  return best;
}

function matchTypeCode(rest) {
  let best = null;
  for (const candidate of TYPE_CODE_DEFS) {
    const result = scoreCandidate(rest, candidate);
    if (!result) continue;
    const isBetter =
      !best ||
      result.matchedText.length > best.matchedText.length ||
      (result.matchedText.length === best.matchedText.length && result.distance < best.distance);
    if (isBetter) best = { ...candidate, matchedText: result.matchedText, distance: result.distance };
  }
  return best;
}

// Real garbled suffixes ("Cг" with a Cyrillic г, "C0", "CE", "Ck") all still start with C; a
// genuine debit balance's suffix starts with D. That leading letter is the only part trusted, which
// covers any single-character-swap variant of "Cr"/"Dr" rather than an enumerated list of them.
function normalizeBalanceType(raw) {
  const upper = clean(raw).toUpperCase();
  return upper.startsWith("D") ? "DR" : "CR";
}

// Narration text (UPI handles, NEFT/TRF reference lines) is kept close to verbatim -- it's mostly
// account/reference numbers and email-shaped handles that shouldn't be rewritten -- but the handful
// of recurring plain-word tokens in it are OCR'd inconsistently across samples ("NEET"/"NEFT",
// "TRE"/"TRF") the same way the row's own type code is, so the same small edit-distance check
// normalizes them to one canonical spelling. Restricted to whole alphabetic tokens close in length
// to the canonical word so it can't touch a name, an account number, or an email handle.
const NARRATION_VOCAB = ["NEFT", "UPI", "TRF"];

function normalizeNarrationWord(word) {
  if (!/^[A-Za-z]+$/.test(word)) return word;
  const upper = word.toUpperCase();
  for (const canonical of NARRATION_VOCAB) {
    if (upper === canonical) return canonical;
    if (Math.abs(upper.length - canonical.length) <= 1 && levenshtein(upper, canonical) <= 1) return canonical;
  }
  return word;
}

function normalizeNarrationLine(line) {
  return line
    .split(/(\s+)/)
    .map((token) => normalizeNarrationWord(token))
    .join("");
}

// A trailing decimal amount immediately followed by a Cr/Dr-ish suffix and nothing else -- this
// format's own balance shape -- used to recognize a "carried forward" line below (a block with no
// date at all, just leftover narration and a balance) and, in parseBlock, to recover a balance that
// got separated from its own row-start line onto the very next line instead (see there for why).
const TRAILING_BALANCE = new RegExp(`(${AMOUNT})\\s*([A-Za-z]{1,3})`);

// Groups OCR lines into one raw-line-array block per transaction: a Post-Date/Value-Date-leading
// line opens a new block, everything else (narration continuation, or noise -- header/footer chrome,
// the bank's page-break repeat of "BROUGHT FORWARD", the footer totals header, or its disclaimer) is
// either appended to the open block or dropped.
//
// One more block shape besides an ordinary dated row: this bank sometimes prints a page's very first
// entry as a *carried-forward* line -- no date, no type code, just the previous page's last cheque's
// payee name and the resulting balance (its date, type, and amount having already been recorded on
// the page before). A real sample's "BROUGHT FORWARD" carried no balance of its own on that line;
// the balance instead landed on this separate, undated line a few lines later. Opening a block for
// it here -- rather than silently dropping it because no dated row is open yet, the same
// first-block-of-page loss this fixes for the BROUGHT-FORWARD-merge case above -- is what lets
// parseCarriedForwardBlock recover it as its own row further down.
function groupIntoBlocks(lines) {
  const blocks = [];
  let current = null;
  let pastFooterHeader = false;

  for (const rawLine of lines) {
    let text = normalizeSpacedDates(clean(rawLine.text || rawLine));
    if (!text) continue;

    text = stripBroughtForwardPrefix(text);
    if (!text) continue;

    if (isTerminalLine(text)) {
      if (current) blocks.push(current);
      current = null;
      // Once the footer totals header has been seen, everything after it (including its own values
      // row, which itself ends in a balance-shaped "...23,108.86Cr") is footer content, never a new
      // transaction -- without this, the carried-forward fallback below mistook that values row for
      // an orphaned carried-forward line and fabricated a spurious 15th "transaction" out of it.
      if (isFooterTotalsHeaderLine(text)) pastFooterHeader = true;
      continue;
    }
    if (isHeaderFooterLine(text)) continue;

    if (ROW_START.test(text)) {
      if (current) blocks.push(current);
      current = [text];
      continue;
    }

    if (!current && !pastFooterHeader && TRAILING_BALANCE.test(text)) {
      current = [text];
      continue;
    }

    if (current) current.push(text);
  }
  if (current) blocks.push(current);

  return blocks;
}

// Recovers a balance (and the suffix it needs for Type) that OCR separated from its own row-start
// line onto the very next line instead -- a real sample's row-start carried only the transaction
// amount ("DEP TFR 27665.09"), with the resulting balance turning up embedded in the following
// narration line ("NEET YESB000000 ] 69650.56C ."). Only ever consulted when the row-start line
// itself had exactly one amount (see parseBlock) -- a row-start with its own two amounts is always
// trusted over this. Returns the line with the matched balance fragment removed, so it doesn't also
// survive into Particulars as a leaked number.
function extractBalanceFromLine(line) {
  const match = line.match(TRAILING_BALANCE);
  if (!match) return null;
  const balance = roundMoney(Number(match[1].replace(/,/g, "")));
  const balanceType = normalizeBalanceType(match[2]);
  const consumedEnd = match.index + match[0].length;
  const remainder = clean(`${line.slice(0, match.index)} ${line.slice(consumedEnd)}`);
  return { balance, balanceType, remainder };
}

// A carried-forward block (see groupIntoBlocks) has no date, no type code, and no amount of its
// own -- just narration and a trailing balance. Kept as its own output row (Date/Value Date blank,
// Withdrawal/Deposit blank) rather than folded silently into the statement's opening balance, since
// it carries real printed content (a payee name) that would otherwise vanish, and its balance is
// what fillMissingBalances chains the rest of the page's rows from.
function parseCarriedForwardBlock(block) {
  const [firstLine, ...continuationLines] = block;
  const recovered = extractBalanceFromLine(firstLine);
  if (!recovered) return null;

  const particulars =
    clean([normalizeNarrationLine(recovered.remainder), ...continuationLines.map(normalizeNarrationLine)].filter(Boolean).join(" ")) ||
    "TRANSACTION";

  return {
    date: null,
    valueDate: null,
    particulars,
    tranType: null,
    chequeNo: null,
    chequeDetails: null,
    withdrawal: null,
    deposit: null,
    balance: recovered.balance,
    type: recovered.balanceType,
  };
}

function parseBlock(block) {
  const [firstLine, ...continuationLines] = block;
  const rowMatch = firstLine.match(ROW_START);
  if (!rowMatch) return null;

  const [, postDateRaw, valueDateRaw, rest] = rowMatch;
  // Post Date and Value Date are identical on every row in every real sample of this statement, so
  // the second blob is never independently trusted even when it *looks* like a valid date -- a real
  // sample OCR'd "07" as "01" in the Value Date slot alone ("31/07/26 31/01/26"), which parses as a
  // perfectly valid (wrong) date and so wasn't caught by only checking whether parsing failed. Using
  // one date for both isn't a guess here, it's the statement's own printed invariant; the second
  // blob is only ever consulted as the fallback when the *first* one fails to parse at all.
  const date = parseLooseDate(postDateRaw) || parseLooseDate(valueDateRaw);
  if (!date) return null;
  const valueDate = date;

  const typeCode = matchTypeCode(rest);
  const afterType = fixCommaDecimal(typeCode ? rest.slice(typeCode.matchedText.length) : rest);

  const amounts = [...afterType.matchAll(new RegExp(AMOUNT, "g"))];
  let balanceMatch = null;
  let amountMatch = null;
  if (amounts.length >= 2) {
    balanceMatch = amounts[amounts.length - 1];
    amountMatch = amounts[amounts.length - 2];
  } else if (amounts.length === 1) {
    // Real OCR sometimes drops the balance from the row-start line entirely, leaving only the
    // transaction amount there ("DEP TFR 27665.09", balance nowhere on this line) -- the lone
    // surviving number here is always the amount, never the balance, in every case seen so far. The
    // balance itself is looked for on the very next line below, and if it's not recoverable there
    // either, fillMissingBalances reconstructs it from the running balance chain once every block
    // has been parsed.
    amountMatch = amounts[0];
  }

  let balance = null;
  let balanceType = null;
  // Tracks how this row's balance was obtained: read straight off the row-start line ("row-start",
  // this format's cleanest text) vs recovered from a continuation line embedded in other narration
  // ("continuation", noisier context, more prone to its own independent OCR corruption). Consumed
  // and stripped by reconcileBalanceChain below -- a "continuation" balance that disagrees with what
  // this row's own amount implies gets replaced by the chain-computed value, a "row-start" one does
  // not (it's already the more reliable of the two sources).
  let balanceSource = null;
  if (balanceMatch) {
    balance = roundMoney(Number(balanceMatch[0].replace(/,/g, "")));
    const suffixMatch = afterType.slice(balanceMatch.index + balanceMatch[0].length).match(/^\s*([A-Za-z]{1,3})/);
    balanceType = normalizeBalanceType(suffixMatch ? suffixMatch[1] : "Cr");
    balanceSource = "row-start";
  } else if (continuationLines.length) {
    const recovered = extractBalanceFromLine(continuationLines[0]);
    if (recovered) {
      balance = recovered.balance;
      balanceType = recovered.balanceType;
      continuationLines[0] = recovered.remainder;
      balanceSource = "continuation";
    }
  }

  const amount = amountMatch ? roundMoney(Number(amountMatch[0].replace(/,/g, ""))) : null;

  // Chq no is only ever printed on a CAS PRES CHQ row (the rows this bank actually issues cheques
  // against) -- restricting extraction to that row type, rather than any bare 5-7 digit run before
  // the amount, keeps a UPI/NEFT reference number on every other row type from being misread as one.
  const beforeAmount = afterType.slice(0, amountMatch ? amountMatch.index : afterType.length);
  const chequeMatch = typeCode?.label === "CAS PRES CHQ" ? beforeAmount.match(/\b\d{5,7}\b/) : null;
  const chequeDetails = chequeMatch ? chequeMatch[0] : null;

  const narrationHead = normalizeNarrationLine(clean(beforeAmount.replace(chequeMatch ? chequeMatch[0] : "", "")));
  // When no type code was recognizable at all, the leading particulars text comes solely from
  // narrationHead (already correctly sliced up to wherever the amount was found), never from a raw
  // dump of the whole `rest` text -- an earlier cut of this used `rest` here unconditionally, which
  // (since afterType === rest in the no-type-code case) duplicated the type-code-ish words *and* the
  // amount/balance digits into Particulars a second time on top of narrationHead already having them.
  const particulars = clean(
    [typeCode ? typeCode.label : null, narrationHead, ...continuationLines.map(normalizeNarrationLine)].filter(Boolean).join(" "),
  ) || "TRANSACTION";

  const direction = typeCode ? typeCode.direction : "credit";

  return {
    date,
    valueDate,
    particulars,
    tranType: typeCode ? typeCode.label : null,
    chequeNo: null,
    chequeDetails,
    withdrawal: amount !== null && direction === "debit" ? amount : null,
    deposit: amount !== null && direction === "credit" ? amount : null,
    balance,
    type: balanceType,
    balanceSource,
  };
}

// The footer prints as a header row ("Ope Bal | Dr count | Cr count | Debits | Credits | Clo Bal")
// followed by its own values row. Read that values row on its own (rather than scanning the whole
// flattened statement text for "Debits" followed by a number) because "Debits"/"Credits"/"Clo Bal"
// are column headers with the Dr count/Cr count *integers* sitting between the header words and
// their actual decimal values -- the three decimal amounts on the values row, taken in printed
// order, are unambiguously Debits/Credits/Clo Bal regardless of how many integer counts precede
// them. Only present once the statement's later page(s) are included; absence here just means this
// page didn't carry it, not an error (per this bank's own multi-page layout).
function extractPrintedTotals(lines) {
  const cleanedLines = lines.map((line) => normalizeSpacedDates(clean(line.text || line)));
  const headerIndex = cleanedLines.findIndex((line) => isFooterTotalsHeaderLine(line));
  if (headerIndex === -1) return null;

  const valuesLine = cleanedLines.slice(headerIndex + 1).find((line) => line);
  if (!valuesLine) return null;

  const amounts = [...valuesLine.matchAll(new RegExp(AMOUNT, "g"))].map((m) => Number(m[0].replace(/,/g, "")));
  if (amounts.length < 3) return null;

  return {
    source: "printed",
    withdrawal: amounts[amounts.length - 3],
    deposit: amounts[amounts.length - 2],
    closingBalance: amounts[amounts.length - 1],
  };
}

function parseAnyBlock(block) {
  return ROW_START.test(block[0]) ? parseBlock(block) : parseCarriedForwardBlock(block);
}

// Two jobs, both working off the same running chain (previous row's own balance +/- this row's own
// withdrawal/deposit): (1) fill in a row's balance from the chain when it couldn't be read from the
// statement text at all -- neither on the row-start line nor recoverable from the next line
// (extractBalanceFromLine, in parseBlock) -- since correctDebitCreditByBalance (shared across every
// parser, run later in parser.js) only ever *corrects* a balance already present on both sides of a
// gap, it can't synthesize one from nothing. (2) Re-check a balance that *was* found, but only via
// the noisier continuation-line recovery path: a real sample's continuation line read a balance as
// "...50.56" where the actual printed digit was "...60.56" (confirmed independently -- every other
// row's own amount on that page, chained from the opening balance, lands exactly on the page's
// printed closing balance only with "...60.56"). A row-start-line balance is never second-guessed
// this way; it's already this format's most reliable field.
function reconcileBalanceChain(transactions, openingBalance) {
  let running = openingBalance;
  for (const row of transactions) {
    const amount = row.withdrawal ?? row.deposit;
    const signed = amount === null ? null : row.withdrawal !== null ? -amount : amount;
    const chainBalance = running !== null && signed !== null ? roundMoney(running + signed) : null;

    if (row.balance === null) {
      if (chainBalance !== null) row.balance = chainBalance;
    } else if (row.balanceSource === "continuation" && chainBalance !== null && Math.abs(row.balance - chainBalance) > 1) {
      row.balance = chainBalance;
    }

    delete row.balanceSource;
    if (row.balance !== null) running = row.balance;
  }
}

function parseGreaterBombayTransactions(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  const openingBalance = extractOpeningBalance(text);
  const printedTotals = extractPrintedTotals(lines);

  const blocks = groupIntoBlocks(lines);
  const transactions = blocks.map(parseAnyBlock).filter(Boolean);
  reconcileBalanceChain(transactions, openingBalance);

  return { transactions, openingBalance, printedTotals };
}

export { isGreaterBombayLayoutText, isGreaterBombayContinuationText, parseGreaterBombayTransactions };
