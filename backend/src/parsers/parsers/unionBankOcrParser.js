import { clean, parseAmount, roundMoney } from "./common.js";
import { correctDebitCreditByBalance } from "../validation.js";

// This is a distinct Union Bank export from the one unionBankParser.js handles: a scanned
// "Transaction Inquiry"-style statement (Sl No / Date / Particulars / Chq Num / Withdrawal /
// Deposit / Balance columns, OCR'd rather than a native text layer) instead of that other
// format's "DATE PARTICULARS CHQ.NO WITHDRAWALS DEPOSITS BALANCE" header. Only ever matches OCR
// output -- a real text layer never reflows this table the way isRowAnchor/bracketing below
// assumes.
function isUnionBankOcrLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /UBIN\d{7}/i.test(text) && /SI\s+Date\b.*\bWithdrawal\s+Deposit\s+Balance/i.test(text);
}

const HEADER_ROW_PATTERN = /^SI\s+Date\b/i;
const OPENING_BALANCE_PATTERN = /^(\d+)\s+Opening Balance\s+([\d,]+\.\d{2})\s*(Cr|Dr)?$/i;
const PAGE_FOOTER_PATTERN = /^\d+\s+of\s+\d+$/i;
// The Sl No is always followed by a date, but OCR occasionally reorders/misplaces the date's own
// dashes (e.g. "16 - - 17 04 2025" instead of "16 17 - 04 - 2025" for Sl 16) while still reading
// the day/month/year digits themselves in the correct order. Matching a loose digit/dash/space
// run ending in a bare 4-digit year -- rather than requiring dashes in exactly the right three
// places -- tolerates that without misreading the amount columns further down the line as part
// of the date (a real amount always carries a decimal point, which this run excludes).
const ANCHOR_ROW_PATTERN = /^(\d+)\s+([\d\s-]{6,20}?\d{4})\s+(.*)$/;
const TRAILING_AMOUNT_PATTERN = /^(.*?)\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*(Cr|Dr)$/i;
const TRAILING_CHEQUE_NO_PATTERN = /^(.*?)\s*(\d{6,10})$/;

function buildDate(day, month, year) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

// The narrow Particulars column wraps mid-word rather than at a token boundary (e.g.
// "...ONE97CO" / "MMUNICATION/..." is really the single word "ONE97COMMUNICATION" split by the
// column edge), so a letter-to-letter join needs no space to read correctly; anything else
// (numbers, punctuation, slashes) keeps the space a real token boundary would have.
function joinWrappedText(before, after) {
  if (!before) return after;
  if (!after) return before;
  const lastChar = before[before.length - 1];
  const firstChar = after[0];
  const isWordBreak = /[A-Za-z]/.test(lastChar) && /[A-Za-z]/.test(firstChar);
  return isWordBreak ? `${before}${after}` : `${before} ${after}`;
}

// Splits an anchor row's own trailing text (after Sl + Date) into: any inline narration text
// (only present for the handful of rows short enough to fit without wrapping, e.g. SMS charge
// fees or the few named Chq Num rows), an optional Chq Num (a bare 6-10 digit run distinguished
// from the inline narration's own text by trailing position), and the amount/balance/Cr-Dr.
function parseAnchorTail(tail) {
  const match = clean(tail).match(TRAILING_AMOUNT_PATTERN);
  if (!match) return null;

  const [, middle, amountRaw, balanceRaw, sign] = match;
  const amount = parseAmount(amountRaw);
  const balance = parseAmount(`${balanceRaw}${sign}`);
  if (amount === null || balance === null) return null;

  let inlineNarration = clean(middle);
  let chequeNo = null;
  const chequeMatch = inlineNarration.match(TRAILING_CHEQUE_NO_PATTERN);
  if (chequeMatch && chequeMatch[2]) {
    chequeNo = chequeMatch[2];
    inlineNarration = clean(chequeMatch[1]);
  }

  return { amount, balance, inlineNarration, chequeNo };
}

function parseAnchorLine(text) {
  const opening = clean(text).match(OPENING_BALANCE_PATTERN);
  if (opening) {
    const balance = parseAmount(`${opening[2]}${opening[3] || "Cr"}`);
    return { sl: Number(opening[1]), isOpeningBalance: true, balance };
  }

  const row = clean(text).match(ANCHOR_ROW_PATTERN);
  if (!row) return null;

  const [, sl, dateZone, tail] = row;
  const dateDigits = dateZone.replace(/\D/g, "");
  if (dateDigits.length !== 8) return null;

  const parsedTail = parseAnchorTail(tail);
  if (!parsedTail) return null;

  return {
    sl: Number(sl),
    isOpeningBalance: false,
    date: buildDate(dateDigits.slice(0, 2), dateDigits.slice(2, 4), dateDigits.slice(4, 8)),
    ...parsedTail,
  };
}

// Everything that isn't an anchor row is either page letterhead/account-info/footer boilerplate
// (only ever appears before this page's own "SI Date ..." header, or after the closing "Summary"
// block) or a genuine wrapped-narration fragment that belongs to the row immediately above or
// below it. Gating on the header/Summary markers, rather than blacklisting every OCR-garbled
// variant of the letterhead text, is what keeps that boilerplate out without needing to recognize
// it by content.
function collectContentLines(lines) {
  const content = [];
  let inTable = false;
  let currentPage = null;
  let stopped = false;
  const totals = { withdrawal: null, deposit: null, closingBalance: null };

  for (const entry of lines) {
    if (stopped) continue;
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (entry.pageNumber !== currentPage) {
      currentPage = entry.pageNumber;
      inTable = false;
    }

    if (HEADER_ROW_PATTERN.test(text)) {
      inTable = true;
      continue;
    }

    if (PAGE_FOOTER_PATTERN.test(text)) continue;

    const debitsMatch = text.match(/^Total Debits\s*:\s*([\d,]+\.\d{2})/i);
    if (debitsMatch) {
      totals.withdrawal = parseAmount(debitsMatch[1]);
      continue;
    }
    const creditsMatch = text.match(/^Total Credits\s*:\s*([\d,]+\.\d{2})/i);
    if (creditsMatch) {
      totals.deposit = parseAmount(creditsMatch[1]);
      continue;
    }
    const closingMatch = text.match(/Closing Balance\s*:\s*([\d,]+\.\d{2})\s*(Cr|Dr)/i);
    if (closingMatch) {
      totals.closingBalance = parseAmount(`${closingMatch[1]}${closingMatch[2]}`);
      continue;
    }

    if (/^OTHER ACCOUNT DETAILS\b/i.test(text)) {
      stopped = true;
      continue;
    }

    if (!inTable) continue;

    content.push({ ...entry, text });
  }

  return { content, totals };
}

function parseUnionBankOcrTransactions(lines) {
  const { content, totals } = collectContentLines(lines);

  // Pass 1: find every anchor row (Sl No + Date/Opening Balance) and its own line index within
  // `content`, so wrapped-narration fragments between two anchors can be assigned to whichever
  // one they're visually closer to.
  const anchors = [];
  for (let index = 0; index < content.length; index += 1) {
    const parsed = parseAnchorLine(content[index].text);
    if (parsed) anchors.push({ ...parsed, index, page: content[index].pageNumber, y: content[index].top });
  }

  const before = new Array(anchors.length).fill("");
  const after = new Array(anchors.length).fill("");

  for (let a = 0; a < anchors.length; a += 1) {
    const start = anchors[a].index + 1;
    const end = a + 1 < anchors.length ? anchors[a + 1].index : content.length;
    if (start >= end) continue;

    const prevAnchor = anchors[a];
    const nextAnchor = a + 1 < anchors.length ? anchors[a + 1] : null;

    for (let index = start; index < end; index += 1) {
      const line = content[index];
      const sameLineAsPrev = line.pageNumber === prevAnchor.page;
      const sameLineAsNext = nextAnchor && line.pageNumber === nextAnchor.page;

      let belongsToPrev;
      if (sameLineAsPrev && sameLineAsNext) {
        const midpoint = (prevAnchor.y + nextAnchor.y) / 2;
        belongsToPrev = line.top <= midpoint;
      } else if (sameLineAsPrev) {
        belongsToPrev = true;
      } else {
        belongsToPrev = false;
      }

      if (belongsToPrev) {
        after[a] = joinWrappedText(after[a], line.text);
      } else if (nextAnchor) {
        before[a + 1] = joinWrappedText(before[a + 1], line.text);
      }
    }
  }

  const transactions = [];
  let openingBalance = null;
  let previousBalance = null;

  for (let a = 0; a < anchors.length; a += 1) {
    const anchor = anchors[a];

    if (anchor.isOpeningBalance) {
      openingBalance = anchor.balance;
      previousBalance = anchor.balance;
      continue;
    }

    let particulars = joinWrappedText(before[a], anchor.inlineNarration);
    particulars = joinWrappedText(particulars, after[a]);
    particulars = clean(particulars) || "TRANSACTION";

    const delta = previousBalance === null ? null : roundMoney(anchor.balance - previousBalance);
    const withdrawal = delta !== null && delta < 0 ? anchor.amount : null;
    const deposit = delta !== null && delta >= 0 ? anchor.amount : null;

    transactions.push({
      sl: anchor.sl,
      date: anchor.date,
      valueDate: anchor.date,
      particulars,
      chequeNo: anchor.chequeNo,
      withdrawal,
      deposit,
      balance: anchor.balance,
    });

    previousBalance = anchor.balance;
  }

  return {
    transactions: correctDebitCreditByBalance(transactions),
    openingBalance,
    printedTotals:
      totals.withdrawal !== null || totals.deposit !== null || totals.closingBalance !== null
        ? { source: "printed", ...totals }
        : null,
  };
}

export { isUnionBankOcrLayout, parseUnionBankOcrTransactions };
