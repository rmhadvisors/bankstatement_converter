// Fixtures isolating one general OCR-noise *pattern* per export, rather than one fixture per photo.
// Each covers a class of corruption the generalized matching in greaterBombayParser.js is meant to
// absorb (fuzzy type-code distance, currency-suffix lookalikes, comma-decimal misreads) so a future
// photo with similar-but-not-identical garbling -- not just an exact re-run of a past file -- is
// caught by the same test.

const HEADER = [
  "GREATER BANK",
  "THE GREATER BOMBAY CO-OP BANK",
  "IFSC : GBCB0000014",
  "Post Date Value Date Details Chq no Debit Credit Balance",
  "BROUGHT FORWARD: 100000.00Cr",
];

// Currency-suffix lookalikes: every observed garbled variant of "Cr" starts with a C, and "Dr"
// starts with a D -- normalizeBalanceType trusts only that leading letter, so any single-character
// OCR substitution after it (not just the specific ones seen so far) reads correctly.
export const currencySuffixVariantLines = [
  ...HEADER,
  "01/01/26 01/01/26 DEP TFR 1000.00 101000.00Cr",
  "01/02/26 01/02/26 DEP TFR 1000.00 102000.00Cг", // Cyrillic г lookalike
  "01/03/26 01/03/26 DEP TFR 1000.00 103000.00C0", // 0 for r
  "01/04/26 01/04/26 DEP TFR 1000.00 104000.00CE", // E for r
  "01/05/26 01/05/26 DEP TFR 1000.00 105000.00Ck", // k for r
  "01/06/26 01/06/26 WDL TFR 500.00 104500.00Dr", // genuine debit balance, must not be misread as credit
];

// Comma-for-period decimal misreads, on both the transaction amount and the balance independently.
export const commaDecimalVariantLines = [
  ...HEADER,
  "01/01/26 01/01/26 DEP TFR 1500,25 101500.25Cr", // comma in the amount
  "02/01/26 02/01/26 WDL TFR 300.00 101200,25Cr", // comma in the balance
];

// Garbled type-code vocabulary: letter substitutions on WDL/DEP ("NDL"/"HDL"/"HOL" for WDL, "DERI"
// for DEP) and two code words OCR-merged with no space ("PRESCHO" for "PRES CHQ") -- matchTypeCode's
// whole-phrase edit distance handles both failure modes the same way, without a per-variant table.
export const garbledTypeCodeLines = [
  ...HEADER,
  "01/01/26 01/01/26 NDL TFR 200.00 99800.00Cr",
  "02/01/26 02/01/26 HDL TFR 200.00 99600.00Cr",
  "03/01/26 03/01/26 HOL TFR 200.00 99400.00Cr",
  "04/01/26 04/01/26 DERI TFR 400.00 99800.00Cr",
  "05/01/26 05/01/26 CAS PRESCHO 500123 1000.00 98800.00Cr",
  "00500123 SOME PAYEE",
];

// A page/photo that shows only transaction rows -- no bank name, no IFSC, no BROUGHT FORWARD, no
// column header -- the shape a later page of a multi-page statement takes when each page is its own
// photo with no shared header. Detected purely by row shape + recognizable type-code vocabulary.
export const continuationOnlyLines = [
  "15/01/26 15/01/26 DEP TFR 2000.00 87000.00Cr",
  "NEFT SOMEBANK0002",
  "REF99988877 SOMEONE",
  "TRF FR 0022233344455",
  "16/01/26 16/01/26 WDL TFR 750.00 86250.00Cr",
  "UPI 111222333444",
  "vendor@okbank",
  "TRF TO 0055566677788",
];

// "BROUGHT FORWARD <balance>" glued directly onto the very next line's own date-leading transaction
// text with no line break between them (a real observed OCR artifact, not hypothetical) -- the
// first transaction on the page must still be recovered, not dropped along with the opening-balance
// restatement it's stuck to.
export const broughtForwardMergedWithFirstRowLines = [
  ...HEADER,
];
broughtForwardMergedWithFirstRowLines[broughtForwardMergedWithFirstRowLines.length - 1] =
  "BROUGHT FORWARD: 100000.00Cr 01/01/26 01/01/26 DEP TFR 2500.00 102500.00Cr";
broughtForwardMergedWithFirstRowLines.push(
  "NEFT SOMEBANK0003",
  "REF11122233 SOMEONE",
  "TRF FR 0088899900011",
  "02/01/26 02/01/26 WDL TFR 400.00 102100.00Cr",
  "UPI 555666777888",
  "vendor2@okicici",
  "TRF TO 0022255588822",
);

// A page-boundary disclaimer with wording that shares almost no vocabulary with the one sample seen
// so far, and a totals-header spelled differently ("Opening Bal" / "Closing Bal" instead of "Ope
// Bal" / "Clo Bal") -- proves the generic length-shape + fuzzy-word detection isn't just replaying
// one memorized phrase.
export const novelFooterContaminationLines = [
  ...HEADER,
  "20/01/26 20/01/26 WDL TFR 900.00 99100.00Cr",
  "UPI 222333444555",
  "othervendor@okicici",
  "TRF TO 0066677788899",
  "Kindly note that all transactions reflected herein are subject to verification and any discrepancy must be reported to the branch within seven days of this statement",
  "Opening Bal Dr count Cr count Debits Credits Closing Bal",
];
