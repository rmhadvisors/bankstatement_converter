import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { pnbOcrLines } from "./fixtures/pnb-ocr-lines.mjs";

function buildExtraction() {
  return {
    lines: pnbOcrLines.map((text) => ({ text })),
    text: pnbOcrLines.join("\n"),
    pageCount: 11,
    source: "ocr",
  };
}

// Regression fixture for a real pipeline gap: a scanned Punjab National Bank statement (no
// embedded PDF text layer -- pnbParser.js's own strict column-x-coordinate parser only works on a
// native text layer) used to detect as "generic" (the header text OCR's as "IFSC : PUNB..." /
// "Amount ( INR )", which the original tight-spacing-only detection regexes never matched) and
// then fail to extract any transactions at all. Fixed by widening detection to tolerate that
// spacing and adding pnbOcrParser.js, a date-block-reconstruction engine for this specific
// Date/Instrument-ID/Amount/Type/Balance/Remarks column shape.
//
// Ground truth below is cross-checked directly against the source PDF's own rendered table (not
// derived from this parser's output): every cheque/Instrument-ID row (6 of them, #781701-#781706),
// every "Int.Pd" interest row (4 of them), the printed closing balance (6,957.72, the balance on
// the most recent transaction, 31-03-2026), and the full day-to-day balance chain.
test("pipeline resolves a scanned PNB statement (no native text layer) into a structured, row-accurate result", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.detectedFormat, "pnb");
  assert.equal(statement.transactions.length, 330);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.calculatedClosingBalance, 6957.72);

  // Chronological order: oldest transaction first (the statement itself prints newest-first).
  const first = statement.transactions[0];
  const last = statement.transactions[statement.transactions.length - 1];
  assert.equal(first.date.toISOString().slice(0, 10), "2025-04-07");
  assert.equal(last.date.toISOString().slice(0, 10), "2026-03-31");
  assert.equal(last.balance, 6957.72);
  assert.equal(last.type, "DR");
  assert.equal(last.withdrawal, 2000);
});

test("running balance chain reconciles row-to-row from each row's own Amount and Type", () => {
  const statement = parseStatement(buildExtraction());
  const rows = statement.transactions;

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const row = rows[index];
    const expected = Math.round((previous.balance + (row.deposit || 0) - (row.withdrawal || 0)) * 100) / 100;
    assert.equal(row.balance, expected, `row ${index} (${row.date.toISOString().slice(0, 10)}) balance chain`);
    // DR must always reduce the balance and CR must always increase it -- never the reverse.
    if (row.type === "DR") assert.ok(row.withdrawal > 0, `row ${index} Type DR must have a withdrawal amount`);
    if (row.type === "CR") assert.ok(row.deposit > 0, `row ${index} Type CR must have a deposit amount`);
  }
});

test("every cheque/Instrument-ID row is captured with its own chequeNo, amount, and balance", () => {
  const statement = parseStatement(buildExtraction());
  const chequeRows = statement.transactions.filter((row) => row.chequeNo);

  const expected = [
    { chequeNo: "781701", date: "2025-09-11", withdrawal: 18000, balance: 2751.51 },
    { chequeNo: "781702", date: "2025-09-18", withdrawal: 12000, balance: 1875.51 },
    { chequeNo: "781703", date: "2025-10-01", withdrawal: 3200, balance: 535.51 },
    { chequeNo: "781704", date: "2025-11-03", withdrawal: 13000, balance: 1155.81 },
    { chequeNo: "781705", date: "2025-11-10", withdrawal: 90000, balance: 978.81 },
    { chequeNo: "781706", date: "2026-01-19", withdrawal: 25000, balance: 2837.62 },
  ];

  assert.equal(chequeRows.length, expected.length);
  expected.forEach((truth, index) => {
    const row = chequeRows[index];
    assert.equal(row.chequeNo, truth.chequeNo);
    assert.equal(row.date.toISOString().slice(0, 10), truth.date);
    assert.equal(row.withdrawal, truth.withdrawal);
    assert.equal(row.balance, truth.balance);
    assert.equal(row.type, "DR");
  });
});

test("every Int.Pd interest row is captured with its own period and amount", () => {
  const statement = parseStatement(buildExtraction());
  const interestRows = statement.transactions.filter((row) => /Int\.Pd/i.test(row.particulars));

  const expected = [
    { date: "2025-06-03", deposit: 29, balance: 225.61, period: "01-03-2025 to 31-05-2025" },
    { date: "2025-09-04", deposit: 52, balance: 1751.51, period: "01-06-2025 to 31-08-2025" },
    { date: "2025-12-02", deposit: 15, balance: 1813.81, period: "01-09-2025 to 30-11-2025" },
    { date: "2026-03-01", deposit: 7, balance: 185.72, period: "01-12-2025 to 28-02-2026" },
  ];

  assert.equal(interestRows.length, expected.length);
  expected.forEach((truth, index) => {
    const row = interestRows[index];
    assert.equal(row.date.toISOString().slice(0, 10), truth.date);
    assert.equal(row.deposit, truth.deposit);
    assert.equal(row.balance, truth.balance);
    assert.equal(row.type, "CR");
    assert.ok(row.particulars.includes(truth.period), `row ${index} interest period text`);
  });
});

// The specific bug this guards against: an OCR-misread Amount/Instrument-ID cell that doesn't
// match this row shape at all must be flagged for manual review, never silently dropped or
// guessed at -- the same anti-fabrication principle already applied elsewhere in this project.
test("rows with an unreadable Amount/Instrument-ID cell are flagged for review, not fabricated", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.reviewRows.length, 2);
  for (const row of statement.reviewRows) {
    assert.ok(row.particulars.includes("08/07/2025"));
    assert.equal(row.balance, null);
    assert.equal(row.confidence, 0);
  }
});
