import { clean } from "./common.js";
import { isFinacleTransactionInquiryText } from "./finacleOcrParser.js";
import { isFederalLayoutText } from "./federalParser.js";
import { isPnbLayoutText } from "./pnbParser.js";
import { isGreaterBombayLayoutText, isGreaterBombayContinuationText } from "./greaterBombayParser.js";

function detectBank(pdfTextOrLines) {
  const text = Array.isArray(pdfTextOrLines)
    ? pdfTextOrLines.map((line) => clean(line.text || line)).join("\n")
    : clean(pdfTextOrLines);

  // Delegates to the parser's own layout check (rather than a second, independently-maintained
  // regex here) so this early format guess and the parser branch that actually acts on it can
  // never disagree -- the two used to drift, which is how a noisy OCR pass could get detected as
  // "generic" here while the parser's own (then-stricter) check also failed, with no single place
  // to fix that covered both.
  if (isFinacleTransactionInquiryText(text)) {
    return "finacle-transaction-inquiry";
  }

  if (
    /BASSEIN\s+CATHOLIC\s+CO-OP\s+BANK\s+LTD/i.test(text) &&
    /TRANS\s+DATE\s+VALUE\s+DATE\s+REFF\s+DESCRIPTION\s+DEBITS\s+CREDITS\s+BALANCE/i.test(text)
  ) {
    return "bccb-ledger";
  }

  if (
    /APNA\s+SAHAKARI\s+BANK\s+LTD/i.test(text) &&
    /R045006\s*-\s*STATEMENT OF ACCOUNTS/i.test(text) &&
    /Date\s+Particulars\s+Instruments\s+Dr Amount\s+Cr Amount\s+Total Amount/i.test(text)
  ) {
    return "apna-sahakari";
  }

  if (
    /IDBI\s+BANK\s+LTD/i.test(text) &&
    /REP31\s+Customer\s+Account\s+Ledger/i.test(text) &&
    /GL\.\s+Value\s+Tran\s+Id\s+Instrmnt\s+Particulars\s+Transaction\s+Transaction\s+Balance/i.test(text)
  ) {
    return "idbi-ledger";
  }

  if (
    /IDBI\s+Bank\s+Ltd\.?/i.test(text) &&
    /S\.No\s+Txn Date/i.test(text) &&
    /Withdrawals\s+Deposits\s+Balance/i.test(text)
  ) {
    return "idbi";
  }

  if (/Statement of (?:Axis )?Account No\s*:/i.test(text) && /Tran Date Chq No Particulars Debit Credit Balance Init\./i.test(text)) {
    return "axis";
  }

  if (isFederalLayoutText(text)) {
    return "federal";
  }

  // isGreaterBombayContinuationText needs real line boundaries (it checks each line's own shape),
  // which `text` no longer has once collapsed by clean() above -- passed the original
  // pdfTextOrLines instead, which still has them whether it started as an array or a raw string.
  if (isGreaterBombayLayoutText(text) || isGreaterBombayContinuationText(pdfTextOrLines)) {
    return "greater-bombay";
  }

  if (/CANARA\s+BANK/i.test(text) && /TRANS\s+VALUE\s+BRANCH\s+REF\/CHQ\.NO\s+DESCRIPTION/i.test(text)) {
    return "canara";
  }

  if (
    /UNION\s+BANK\s+OF\s+INDIA/i.test(text) &&
    /DATE\s+PARTICULARS\s+CHQ\.?NO\.?\s+WITHDRAWALS\s+DEPOSITS\s+BALANCE/i.test(text)
  ) {
    return "union-bank";
  }

  if (isPnbLayoutText(text)) {
    return "pnb";
  }

  if (
    (/(BANK\s+OF\s+INDIA|IFSC:\s*BKID)/i.test(text) &&
      (/\|\s*DATE\s*\|\s*PARTICULARS\s*\|CHQ-NO\|\s*Debit\s*\|\s*Credit/i.test(text) ||
        /Sr No\s+Date\s+Remarks\s+Debit\s+Credit\s+Balance/i.test(text))) ||
    /IFSC:\s*BKID/i.test(text)
  ) {
    return "bank-of-india";
  }

  if (
    /Jana Small Finance Bank Ltd\./i.test(text) &&
    /Txn Date/i.test(text) &&
    /Narration/i.test(text) &&
    /Reference/i.test(text) &&
    /Deposits/i.test(text) &&
    /Withdrawal/i.test(text) &&
    /Balance/i.test(text)
  ) {
    return "jana";
  }


  if (/State Bank of India/i.test(text) && /STATEMENT OF ACCOUNT/i.test(text) && /IFSC Code\s*:\s*SBIN/i.test(text)) {
    return "sbi";
  }
  return "generic";
}

export { detectBank };
