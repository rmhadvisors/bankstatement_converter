import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { federal019068Lines } from "./fixtures/federal-019068-lines.mjs";

function buildExtraction() {
  return {
    lines: federal019068Lines.map((text) => ({ text })),
    text: federal019068Lines.join("\n"),
    pageCount: 1,
    source: "pdf",
  };
}

// Ground truth transcribed directly from the source PDF's own clean, human-legible table.
const GROUND_TRUTH = [
  { date: "2026-07-02", tranId: "S1042241", deposit: 158900.0, balance: 1891400.0 },
  { date: "2026-07-10", tranId: "S35359856", deposit: 4760.0, balance: 1896160.0 },
  { date: "2026-07-13", tranId: "S84433720", deposit: 70000.0, balance: 1966160.0 },
  { date: "2026-07-14", tranId: "S99281292", deposit: 140000.0, balance: 2106160.0 },
  { date: "2026-07-15", tranId: "S16555172", deposit: 260400.0, balance: 2366560.0 },
  { date: "2026-07-17", tranId: "S48558980", deposit: 70000.0, balance: 2436560.0 },
  { date: "2026-07-24", tranId: "S56451249", deposit: 277900.0, balance: 2714460.0 },
  { date: "2026-07-27", tranId: "S3740859", deposit: 409500.0, balance: 3123960.0 },
  { date: "2026-07-28", tranId: "S18995728", deposit: 102200.0, balance: 3226160.0 },
  { date: "2026-07-30", tranId: "S52935737", deposit: 2250220.0, balance: 5476380.0 },
];

// Regression test for a real pipeline failure distinct from every other Federal Bank sample: an
// all-deposit statement (zero withdrawals) where every row shares one recurring particulars token
// and the header's "Particulars" column name is itself letter-spaced past recognition. This used
// to fail bank detection entirely (falling through to the generic parser, which fabricated
// "TRANSACTION"/"1" placeholders and shifted Tran IDs into the amount columns) instead of routing
// into the Federal Bank OCR-tolerant parser this shape needs.
test("all-deposit Federal Bank statement with a recurring particulars token resolves to a row-accurate result", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.detectedFormat, "federal");
  assert.equal(statement.transactions.length, GROUND_TRUTH.length);

  statement.transactions.forEach((transaction, index) => {
    const truth = GROUND_TRUTH[index];
    assert.equal(transaction.date.toISOString().slice(0, 10), truth.date, `row ${index} date`);
    assert.equal(transaction.particulars, "FB1854266", `row ${index} particulars`);
    assert.equal(transaction.tranType, "TRF", `row ${index} tranType`);
    assert.equal(transaction.chequeNo, truth.tranId, `row ${index} Tran ID`);
    assert.equal(transaction.withdrawal, null, `row ${index} withdrawal`);
    assert.equal(transaction.deposit, truth.deposit, `row ${index} deposit`);
    assert.equal(transaction.balance, truth.balance, `row ${index} balance`);
  });

  assert.equal(statement.reconciliation.openingBalance, 1732500.0);
  assert.equal(statement.reconciliation.calculatedClosingBalance, 5476380.0);
  assert.equal(statement.reconciliation.totalCredits, 3743880.0);
  assert.equal(statement.reconciliation.totalDebits, 0);
  assert.equal(statement.reconciliation.status, "PASS");
});
