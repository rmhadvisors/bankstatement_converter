import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { detectBank } from "../src/parsers/parsers/detector.js";
import {
  currencySuffixVariantLines,
  commaDecimalVariantLines,
  garbledTypeCodeLines,
  continuationOnlyLines,
  novelFooterContaminationLines,
  broughtForwardMergedWithFirstRowLines,
} from "./fixtures/greater-bombay-noise-patterns.mjs";

function buildExtraction(lines) {
  return {
    lines: lines.map((text) => ({ text })),
    text: lines.join("\n"),
    pageCount: 1,
    source: "ocr",
  };
}

// Pattern: currency-suffix lookalikes ("Cг", "C0", "CE", "Ck") must all read as CR, and a genuine
// "Dr" balance must still read as DR -- proving the rule is "trust the leading letter", not a list
// of specific garbled spellings.
test("every currency-suffix lookalike variant normalizes to the correct Cr/Dr type", () => {
  const statement = parseStatement(buildExtraction(currencySuffixVariantLines));
  assert.equal(statement.detectedFormat, "greater-bombay");
  const types = statement.transactions.map((row) => row.type);
  assert.deepEqual(types, ["CR", "CR", "CR", "CR", "CR", "DR"]);
  assert.equal(statement.transactions[statement.transactions.length - 1].balance, 104500);
});

// Pattern: comma-for-period decimal misreads, independently on the transaction amount and the
// balance -- neither should be truncated or misrouted into the wrong column.
test("comma-for-period decimal misreads are corrected on both amount and balance", () => {
  const statement = parseStatement(buildExtraction(commaDecimalVariantLines));
  assert.equal(statement.detectedFormat, "greater-bombay");
  assert.equal(statement.transactions[0].deposit, 1500.25);
  assert.equal(statement.transactions[0].balance, 101500.25);
  assert.equal(statement.transactions[1].withdrawal, 300);
  assert.equal(statement.transactions[1].balance, 101200.25);
});

// Pattern: garbled type-code vocabulary -- letter substitutions ("NDL"/"HDL"/"HOL" for WDL, "DERI"
// for DEP) and two code words merged with no space ("PRESCHO" for "PRES CHQ") -- all resolve to the
// correct canonical type and withdrawal/deposit direction via edit-distance matching, not a
// hardcoded per-variant table.
test("garbled type-code spellings and merged-word codes resolve to the correct canonical type", () => {
  const statement = parseStatement(buildExtraction(garbledTypeCodeLines));
  assert.equal(statement.detectedFormat, "greater-bombay");
  const rows = statement.transactions;
  assert.equal(rows[0].tranType, "WDL TFR"); // NDL
  assert.equal(rows[0].withdrawal, 200);
  assert.equal(rows[1].tranType, "WDL TFR"); // HDL
  assert.equal(rows[2].tranType, "WDL TFR"); // HOL
  assert.equal(rows[3].tranType, "DEP TFR"); // DERI
  assert.equal(rows[3].deposit, 400);
  assert.equal(rows[4].tranType, "CAS PRES CHQ"); // PRESCHO (no space)
  assert.equal(rows[4].chequeDetails, "500123");
  assert.equal(rows[4].withdrawal, 1000);
  assert.ok(rows[4].particulars.includes("SOME PAYEE"));
});

// Pattern: a page with no bank name, no IFSC, no BROUGHT FORWARD, no column header -- just
// transaction rows, the shape a later page of a multi-page statement takes as its own photo. Must
// still detect and route through this parser rather than falling into the raw "SCANNED" dump.
test("a header-less continuation page is detected by row shape and transaction vocabulary alone", () => {
  const text = continuationOnlyLines.join("\n");
  assert.equal(detectBank(text), "greater-bombay");
  assert.equal(detectBank(continuationOnlyLines.map((t) => ({ text: t }))), "greater-bombay");

  const statement = parseStatement(buildExtraction(continuationOnlyLines));
  assert.equal(statement.detectedFormat, "greater-bombay");
  assert.equal(statement.transactions.length, 2);
  assert.equal(statement.transactions[0].deposit, 2000);
  assert.equal(statement.transactions[1].withdrawal, 750);
});

// Pattern: "BROUGHT FORWARD <balance>" glued onto the next line's own transaction with no line
// break -- the structural first-transaction-of-page gap that has broken this parser more than once.
// The first transaction must survive, not vanish along with the opening-balance line it's stuck to.
test("a page's first transaction survives even when BROUGHT FORWARD is glued onto its own line", () => {
  const statement = parseStatement(buildExtraction(broughtForwardMergedWithFirstRowLines));
  assert.equal(statement.detectedFormat, "greater-bombay");
  assert.equal(statement.transactions.length, 2);
  assert.equal(statement.transactions[0].deposit, 2500);
  assert.equal(statement.transactions[0].balance, 102500);
  assert.equal(statement.transactions[1].withdrawal, 400);
  assert.equal(statement.transactions[1].balance, 102100);
});

// Pattern: a disclaimer with wording that barely overlaps the one sample seen so far, and a totals
// header spelled "Opening Bal"/"Closing Bal" instead of "Ope Bal"/"Clo Bal". Both must still be
// excluded from the last transaction's Particulars -- proving detection isn't just replaying one
// memorized phrase.
test("novel disclaimer wording and a differently-spelled totals header are still excluded from Particulars", () => {
  const statement = parseStatement(buildExtraction(novelFooterContaminationLines));
  assert.equal(statement.detectedFormat, "greater-bombay");
  const last = statement.transactions[statement.transactions.length - 1];
  assert.equal(last.particulars, "WDL TFR UPI 222333444555 othervendor@okicici TRF TO 0066677788899");
  assert.ok(!/Kindly|verification|discrepancy|Opening Bal|Closing Bal/i.test(last.particulars));
});
