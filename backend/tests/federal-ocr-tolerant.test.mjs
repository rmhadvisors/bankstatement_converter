import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { buildWorkbookBuffer } from "../src/parsers/excelWriter.js";
import { federalOcrLines } from "./fixtures/federal-04920-ocr-lines.mjs";

const XLSX = await import("xlsx");

function buildExtraction() {
  return {
    lines: federalOcrLines.map((text) => ({ text })),
    text: federalOcrLines.join("\n"),
    pageCount: 2,
    source: "ocr",
  };
}

// Ground truth transcribed directly from the source PDF's own clean, human-legible table (not
// from this OCR pass, and not from the pipeline's own output) -- every one of the 27 rows, in
// order. This is what row-level "OCR Corrected" flags must be checked against: total-only
// reconciliation (GRAND TOTAL, closing balance) stays correct even when individual rows in a
// bounded run between two good anchors get their amounts reallocated instead of their balances
// fixed, so it can't catch that class of bug on its own.
const GROUND_TRUTH = [
  { date: "2026-07-01", withdrawal: 50200.0, deposit: null, balance: 1910885.47 },
  { date: "2026-07-01", withdrawal: 5.0, deposit: null, balance: 1910880.47 },
  { date: "2026-07-01", withdrawal: 16000.0, deposit: null, balance: 1894880.47 },
  { date: "2026-07-01", withdrawal: 5.0, deposit: null, balance: 1894875.47 },
  { date: "2026-07-01", withdrawal: 13500.0, deposit: null, balance: 1881375.47 },
  { date: "2026-07-01", withdrawal: 5.0, deposit: null, balance: 1881370.47 },
  { date: "2026-07-01", withdrawal: 5500.0, deposit: null, balance: 1875870.47 },
  { date: "2026-07-01", withdrawal: 2.0, deposit: null, balance: 1875868.47 },
  { date: "2026-07-02", withdrawal: 5000.0, deposit: null, balance: 1870868.47 },
  { date: "2026-07-02", withdrawal: 35.0, deposit: null, balance: 1870833.47 },
  { date: "2026-07-02", withdrawal: null, deposit: 68100.0, balance: 1938933.47 },
  { date: "2026-07-04", withdrawal: 217800.0, deposit: null, balance: 1721133.47 },
  { date: "2026-07-10", withdrawal: null, deposit: 2040.0, balance: 1723173.47 },
  { date: "2026-07-13", withdrawal: null, deposit: 30000.0, balance: 1753173.47 },
  { date: "2026-07-14", withdrawal: null, deposit: 60000.0, balance: 1813173.47 },
  { date: "2026-07-15", withdrawal: null, deposit: 111600.0, balance: 1924773.47 },
  { date: "2026-07-16", withdrawal: 175000.0, deposit: null, balance: 1749773.47 },
  { date: "2026-07-17", withdrawal: 350000.0, deposit: null, balance: 1399773.47 },
  { date: "2026-07-17", withdrawal: null, deposit: 30000.0, balance: 1429773.47 },
  { date: "2026-07-24", withdrawal: null, deposit: 119100.0, balance: 1548873.47 },
  { date: "2026-07-27", withdrawal: null, deposit: 175500.0, balance: 1724373.47 },
  { date: "2026-07-28", withdrawal: null, deposit: 35720.0, balance: 1760093.47 },
  { date: "2026-07-28", withdrawal: null, deposit: 43800.0, balance: 1803893.47 },
  { date: "2026-07-30", withdrawal: 1000000.0, deposit: null, balance: 803893.47 },
  { date: "2026-07-30", withdrawal: null, deposit: 964380.0, balance: 1768273.47 },
  { date: "2026-07-31", withdrawal: 250000.0, deposit: null, balance: 1518273.47 },
  { date: "2026-07-31", withdrawal: 100000.0, deposit: null, balance: 1418273.47 },
];

// Regression test for a real pipeline failure: this file's own OCR pass produced spaced-out
// dates, misread Tran Type codes, digit errors in both balance and amount fields, and several
// rows missing their balance (or the whole amount/balance pair) entirely. The strict
// federalParser.js correctly found nothing (it expects a clean text layer), which used to surface
// as a raw "SCANNED" text dump instead of a structured statement. This asserts the full
// parseStatement() pipeline now resolves it to a structured, row-accurate result via the
// OCR-tolerant fallback parser -- not just a reconciled total.
test("pipeline resolves a badly-OCR'd Federal Bank statement into a structured, row-accurate result", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.detectedFormat, "federal");
  assert.equal(statement.rawLines, undefined);
  assert.equal(statement.transactions.length, GROUND_TRUTH.length);

  let withdrawalSum = 0;
  let depositSum = 0;
  statement.transactions.forEach((transaction, index) => {
    const truth = GROUND_TRUTH[index];
    assert.equal(transaction.date.toISOString().slice(0, 10), truth.date, `row ${index} date`);
    assert.equal(transaction.withdrawal, truth.withdrawal, `row ${index} (${truth.date}) withdrawal`);
    assert.equal(transaction.deposit, truth.deposit, `row ${index} (${truth.date}) deposit`);
    assert.equal(transaction.balance, truth.balance, `row ${index} (${truth.date}) balance`);
    withdrawalSum += transaction.withdrawal || 0;
    depositSum += transaction.deposit || 0;
  });

  assert.equal(Math.round(withdrawalSum * 100) / 100, 2183052.0);
  assert.equal(Math.round(depositSum * 100) / 100, 1640240.0);
});

// The specific bug this test guards against: a bounded run of 2+ consecutive rows between two
// trustworthy anchor balances, where blindly trusting each row's own (wrong) OCR'd balance and
// "correcting" its amount to match produces a result whose *totals* still reconcile (each error
// is offset by the next) but whose *individual rows* are wrong. Total-only checks (GRAND TOTAL,
// closing balance) cannot catch this -- only row-by-row ground truth can.
test("a bounded cascade of consecutive corrected rows resolves to the true per-row split, not just a reconciled total", () => {
  const statement = parseStatement(buildExtraction());

  const row13 = statement.transactions.find((t) => t.date.toISOString().slice(0, 10) === "2026-07-13");
  assert.equal(row13.deposit, 30000, "OCR's own amount (30000) must be kept, not reallocated to 40000");
  assert.equal(row13.balance, 1753173.47, "the OCR'd balance (1763173.47) was the actual digit-transposition error");
  assert.equal(row13.hadOcrCorrection, true);

  const row14 = statement.transactions.find((t) => t.date.toISOString().slice(0, 10) === "2026-07-14");
  assert.equal(row14.deposit, 60000);
  assert.equal(row14.balance, 1813173.47);
  assert.equal(row14.hadOcrCorrection, true);

  const row15 = statement.transactions.find((t) => t.date.toISOString().slice(0, 10) === "2026-07-15");
  assert.equal(row15.deposit, 111600);
  assert.equal(row15.balance, 1924773.47);
  assert.equal(row15.hadOcrCorrection, false); // this row's own OCR balance was already correct
});

// The opposite failure mode: a row where the *amount* (not the balance) was OCR'd wrong. Blindly
// trusting the balance and "correcting" the amount happens to be right here, but only because the
// next row's own numbers independently confirm this row's balance -- the fix must actually check
// that, not assume balance always wins.
test("a row with a wrong OCR'd amount (correct balance) is corrected on the amount, not the balance", () => {
  const statement = parseStatement(buildExtraction());
  const row = statement.transactions.find((t) => t.date.toISOString().slice(0, 10) === "2026-07-30" && t.deposit);

  assert.ok(row, "expected the 30-07-2026 deposit row");
  assert.equal(row.balance, 1768273.47, "OCR's own balance was already correct and must be kept");
  assert.equal(row.deposit, 964380, "OCR read 954380 (digit error); the chain-derived 964380 is correct");
  assert.equal(row.hadOcrCorrection, true);
});

test("Particulars text is recovered for FB1854266-pattern rows instead of dropped to a Tran Type/Tran Id fragment", () => {
  const statement = parseStatement(buildExtraction());
  const fb1854266Rows = statement.transactions.filter((t) => /FB1854266/.test(t.particulars));
  assert.ok(fb1854266Rows.length >= 8, "expected most 'FB1854266' rows to keep that text in particulars");
  for (const row of fb1854266Rows) {
    assert.notEqual(row.particulars, "TRE");
    assert.notEqual(row.particulars, "TRO");
    assert.notEqual(row.particulars, "TAF");
  }
});

// Federal Bank's output must match the exact same bare single-sheet, 10-column-plus-GRAND-TOTAL
// spec as every other bank -- no OCR Corrected/Correction Note columns, no companion sheets, not
// even when the OCR-tolerant parser had to correct several rows internally. That correction detail
// is only ever printed to the console (see logConversionSummary in converter.js), never written
// into the workbook.
test("Excel output is a single bare 'Statement of Account' sheet with a trailing GRAND TOTAL row: no SCANNED dump, no correction columns", async () => {
  const statement = parseStatement(buildExtraction());
  const buffer = await buildWorkbookBuffer(statement);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  assert.deepEqual(workbook.SheetNames, ["Statement of Account"]);
  const sheet = workbook.Sheets["Statement of Account"];
  const cell = (address) => sheet[address]?.v ?? null;

  const headerRow = [
    "Date",
    "Value Date",
    "Particulars / Description",
    "Tran Type",
    "Tran ID",
    "Cheque Details",
    "Withdrawals (INR)",
    "Deposits (INR)",
    "Balance (INR)",
    "Type",
  ];
  headerRow.forEach((label, index) => {
    const column = String.fromCharCode("A".charCodeAt(0) + index);
    assert.equal(cell(`${column}1`), label);
  });
  assert.equal(cell("K1"), null);

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 1, defval: null });
  assert.equal(rows.length, 28); // 27 transaction rows + 1 trailing GRAND TOTAL row
  const totalRow = rows[rows.length - 1];
  const transactionRows = rows.slice(0, -1);
  assert.equal(totalRow[2], "GRAND TOTAL");

  let withdrawalSum = 0;
  let depositSum = 0;
  for (const row of transactionRows) {
    withdrawalSum += row[6] || 0;
    depositSum += row[7] || 0;
  }
  assert.equal(Math.round(withdrawalSum * 100) / 100, 2183052.0);
  assert.equal(Math.round(depositSum * 100) / 100, 1640240.0);

  assert.equal(Math.round((totalRow[6] || 0) * 100) / 100, 2183052.0);
  assert.equal(Math.round((totalRow[7] || 0) * 100) / 100, 1640240.0);
  assert.equal(totalRow[8], transactionRows[transactionRows.length - 1][8]);
});
