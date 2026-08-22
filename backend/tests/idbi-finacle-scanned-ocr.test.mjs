import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { idbiFinacleScannedOcrLines } from "./fixtures/idbi-finacle-scanned-ocr-lines.mjs";

function buildExtraction() {
  return {
    lines: idbiFinacleScannedOcrLines.map((text) => ({ text })),
    text: idbiFinacleScannedOcrLines.join("\n"),
    pageCount: 3,
    source: "ocr",
  };
}

function findRow(statement, dateStr, matcher) {
  return statement.transactions.find((row) => row.date.toISOString().slice(0, 10) === dateStr && (!matcher || matcher(row)));
}

// Five real data-integrity bugs found by comparing this converter's output against the actual
// source PDF (a scanned IDBI Bank Finacle "Transaction Inquiry" export, 3 pages). Each bug is
// pinned to the specific row(s) it broke, transcribed as this real OCR fixture.

// BUG 1 -- an interest row's own date range ("Int.:DD-MM-YYYY To DD-MM-YYYY") was being silently
// dropped, sometimes down to "Int .: To" with no dates at all, sometimes leaving a stray leading
// "." from an adjacent, unrelated OCR token ("- Int .: To"). Root cause: this screen's "General
// Ledger Date" column is a hyperlink, and OCR.space frequently reads it onto its own physical
// line, separated from the rest of its row's content by other lines (see
// ocrTransactionReconstructor.js's own module comments on this). When that separation forces the
// row's real content into ocrTransactionReconstructor.js's trySplitByAmounts() resegmentation path
// (because it landed glued onto an unrelated row's block instead of opening its own), that path
// used to treat *every* date-shaped token anywhere in a split group as a date-column value to
// strip -- including a legitimate date range embedded in the interest narration itself. These four
// rows span pages 1, 2, and 3 of the source PDF and cover every structural shape this bug hit.
test("BUG 1: interest row date ranges survive OCR reconstruction across page boundaries", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(findRow(statement, "2026-03-28").particulars, "Int .: 28-12-2025 To 28-03-2026");
  assert.equal(findRow(statement, "2025-12-27").particulars, "Int .: 28-09-2025 To 27-12-2025");
  assert.equal(findRow(statement, "2025-09-27").particulars, "Int .: 29-06-2025 To 27-09-2025");
  assert.equal(findRow(statement, "2025-06-28").particulars, "Int .: 23-03-2025 To 28-06-2025");

  for (const dateStr of ["2026-03-28", "2025-12-27", "2025-09-27", "2025-06-28"]) {
    const row = findRow(statement, dateStr);
    assert.ok(!row.particulars.startsWith("."), `row ${dateStr} must not have a stray leading "."`);
  }
});

// BUG 2 -- a malformed General-Ledger-Date-hyperlink fragment ("04 - 02 - 1", a stray single digit
// instead of the full year) fell through both the noise-fragment filter (too corrupted to match
// the clean "trailing separator, nothing after" shape) and the real date-boundary matcher (too
// corrupted to parse as a real date), so it silently got appended into the previous row's
// narration as leftover garbage.
test("BUG 2: a corrupted GL-date fragment does not leak into the previous row's narration", () => {
  const statement = parseStatement(buildExtraction());
  const row = findRow(statement, "2026-02-16");

  assert.equal(row.particulars, "SMS_CHARGE_FOR_JUL25_TO_SEP25");
});

// BUG 3 -- a bank reference/UTR number lost a character ("IBKLR..." OCR'd as "IBKR..." on one of
// its two printings in the same statement) with nothing about the corrupted value looking wrong in
// isolation. Since guessing the missing letter would just be fabricating reconciliation data, the
// fix is detection, not silent correction: every RTGS-style reference number in the statement is
// compared against the others in that same family, and an outlier length is flagged for review.
test("BUG 3: a corrupted RTGS reference number is flagged, not silently shipped or guessed at", () => {
  const statement = parseStatement(buildExtraction());
  const flagged = statement.reconciliation.suspiciousReferenceNumbers;

  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].token, "IBKR92026020400004494");
  assert.equal(flagged[0].length, 21);
  assert.equal(flagged[0].expectedLength, 22);

  // The correctly-read RTGS references (same family, same length) must NOT be flagged.
  const flaggedTokens = flagged.map((entry) => entry.token);
  assert.ok(!flaggedTokens.includes("IBKLR92026020400004494"));
  assert.ok(!flaggedTokens.includes("IBKLR92025091500011989"));
  assert.ok(!flaggedTokens.includes("IBKLR92026011700095148"));

  // The corrupted value itself is still exported as-read (never fabricated a replacement letter).
  const row = findRow(statement, "2026-02-04", (t) => t.particulars.includes("Chrgs"));
  assert.equal(row.particulars, "Chrgs for RTGS Cust Pymnt : IBKR92026020400004494");
});

// BUG 4 -- OCR.space's word-level line reconstruction tokenizes a hyphen or slash that's tight
// against its neighbors in the source scan as its own separate "word" and joins every word with a
// single space regardless, inserting spacing that was never in the source PDF and would break
// reconciliation matching against other systems expecting the un-spaced form.
test("BUG 4: narration hyphens and slashes are not padded with spacing that isn't in the source", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(findRow(statement, "2025-12-29", (t) => t.deposit === null).particulars, "NEFT-MAHG0005631-PADMARAM B");
  assert.equal(
    findRow(statement, "2026-02-04", (t) => t.deposit === null).particulars,
    "RTGS/IBKLR92026020400004494/PADMARAM B PATEL",
  );
  assert.equal(findRow(statement, "2025-06-06", (t) => t.withdrawal === 17.7).particulars, "NEFT-CHARGE-DR-IBKL25060639377");
});

// BUG 5 -- the PDF header's explicit "Opening Balance" field (45,543.51 Cr) never appeared as a
// row: the sheet's first row was the first real transaction, whose balance-after already differs
// from the true opening balance, leaving the running balance with no starting point to reconcile
// from. Fixed by adding a synthetic first row sourced from that header field, dated one day before
// the first real transaction.
test("BUG 5: Opening Balance is captured as a row, dated one day before the first transaction", () => {
  const statement = parseStatement(buildExtraction());
  const [first, second] = statement.transactions;

  assert.equal(first.particulars, "Opening Balance");
  assert.equal(first.isSynthetic, true);
  assert.equal(first.balance, 45543.51);
  assert.equal(first.date.toISOString().slice(0, 10), "2025-04-21");

  assert.equal(second.date.toISOString().slice(0, 10), "2025-04-22");
  const dayAfterFirst = new Date(first.date);
  dayAfterFirst.setUTCDate(dayAfterFirst.getUTCDate() + 1);
  assert.equal(dayAfterFirst.getTime(), second.date.getTime());
});

test("full pipeline: statement reconciles end to end after all five fixes", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.detectedFormat, "finacle-transaction-inquiry");
  assert.equal(statement.transactions.length, 38); // 37 real rows + 1 synthetic opening balance
  assert.equal(statement.reconciliation.openingBalance, 45543.51);
  assert.equal(statement.reconciliation.calculatedClosingBalance, 1372.11);
  assert.equal(statement.reconciliation.status, "PASS");
});
