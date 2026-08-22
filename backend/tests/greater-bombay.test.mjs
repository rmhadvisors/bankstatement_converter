import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { page1Lines, footerPageLines, footerPageRealOcrLines } from "./fixtures/greater-bombay-lines.mjs";
import { otherAccountLines } from "./fixtures/greater-bombay-other-account-lines.mjs";

function buildExtraction(lines) {
  return {
    lines: lines.map((text) => ({ text })),
    text: lines.join("\n"),
    pageCount: 1,
    source: "ocr",
  };
}

// Regression fixture for a real pipeline gap: The Greater Bombay Co-operative Bank was flagged as
// unhandled and fell into the generic "SCANNED" raw-text fallback instead of a structured 10-column
// conversion. Ground truth below is transcribed directly from the source photo (page 1, 14
// transactions covering 01/07/26-03/07/26), independently hand-verified to chain balance-to-balance
// from the printed opening balance (332369.82Cr) to the last row's balance (308360.84Cr).
const groundTruth = [
  { date: "2026-07-01", tranType: "DEP TFR", withdrawal: null, deposit: 12196.72, balance: 344566.54, type: "CR" },
  { date: "2026-07-01", tranType: "WDL TFR", withdrawal: 2000, deposit: null, balance: 342566.54, type: "CR" },
  { date: "2026-07-01", tranType: "WDL TFR", withdrawal: 8400, deposit: null, balance: 334166.54, type: "CR" },
  { date: "2026-07-01", tranType: "DEP TFR", withdrawal: null, deposit: 3387, balance: 337553.54, type: "CR" },
  { date: "2026-07-01", tranType: "CAS PRES CHQ", withdrawal: 39119, deposit: null, balance: 298434.54, type: "CR", chequeDetails: "259158" },
  { date: "2026-07-02", tranType: "DEP TFR", withdrawal: null, deposit: 14073, balance: 312507.54, type: "CR" },
  { date: "2026-07-02", tranType: "WDL TFR", withdrawal: 350.90, deposit: null, balance: 312156.64, type: "CR" },
  { date: "2026-07-02", tranType: "CAS PRES CHQ", withdrawal: 7322, deposit: null, balance: 304834.64, type: "CR", chequeDetails: "258549" },
  { date: "2026-07-02", tranType: "CAS PRES CHQ", withdrawal: 2381, deposit: null, balance: 302453.64, type: "CR", chequeDetails: "259156" },
  { date: "2026-07-02", tranType: "CAS PRES CHQ", withdrawal: 2678, deposit: null, balance: 299775.64, type: "CR", chequeDetails: "259159" },
  { date: "2026-07-02", tranType: "CAS PRES CHQ", withdrawal: 3043, deposit: null, balance: 296732.64, type: "CR", chequeDetails: "259157" },
  { date: "2026-07-02", tranType: "BY TRANSFER", withdrawal: null, deposit: 2381, balance: 299113.64, type: "CR" },
  { date: "2026-07-03", tranType: "DEP TFR", withdrawal: null, deposit: 19247.20, balance: 318360.84, type: "CR" },
  { date: "2026-07-03", tranType: "WDL TFR", withdrawal: 10000, deposit: null, balance: 308360.84, type: "CR" },
];

test("Greater Bombay Co-op Bank format is detected and every page-1 row matches ground truth", () => {
  const statement = parseStatement(buildExtraction(page1Lines));

  assert.equal(statement.detectedFormat, "greater-bombay");
  assert.equal(statement.transactions.length, groundTruth.length);

  groundTruth.forEach((truth, index) => {
    const row = statement.transactions[index];
    assert.equal(row.date.toISOString().slice(0, 10), truth.date, `row ${index} date`);
    assert.equal(row.tranType, truth.tranType, `row ${index} tranType`);
    assert.equal(row.withdrawal, truth.withdrawal, `row ${index} withdrawal`);
    assert.equal(row.deposit, truth.deposit, `row ${index} deposit`);
    assert.equal(row.balance, truth.balance, `row ${index} balance`);
    assert.equal(row.type, truth.type, `row ${index} type`);
    assert.equal(row.chequeDetails || null, truth.chequeDetails || null, `row ${index} chequeDetails`);
  });
});

test("cheque narration is reassembled from its wrapped Details lines", () => {
  const statement = parseStatement(buildExtraction(page1Lines));
  const chq259158 = statement.transactions.find((row) => row.chequeDetails === "259158");
  assert.ok(chq259158.particulars.includes("VIKMANI"));
  assert.ok(chq259158.particulars.includes("ENTERPRISES"));

  const dep = statement.transactions[0];
  assert.ok(dep.particulars.includes("YESAP61820604540"));
  assert.ok(dep.particulars.includes("TRF FR 0099509042937"));
});

test("balance chain reconciles exactly, opening to closing", () => {
  const statement = parseStatement(buildExtraction(page1Lines));
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.transactions[0].balance, 344566.54);
  assert.equal(statement.transactions[statement.transactions.length - 1].balance, 308360.84);
});

// GRAND TOTAL recomputed from the corrected 14 rows: withdrawals 2000+8400+39119+350.90+7322+2381
// +2678+3043+10000 = 75293.90; deposits 12196.72+3387+14073+2381+19247.20 = 51284.92. Cross-checked
// against the balance chain itself, not just re-added: 332369.82 opening + 51284.92 - 75293.90 =
// 308360.84, exactly the last row's own printed balance.
test("GRAND TOTAL sums to the balance-chain-verified withdrawal and deposit totals", () => {
  const statement = parseStatement(buildExtraction(page1Lines));
  assert.equal(statement.totals.withdrawal, 75293.90);
  assert.equal(statement.totals.deposit, 51284.92);
  assert.equal(statement.totals.closingBalance, 308360.84);
});

// Real observed bug: the page-boundary disclaimer ("...Please Check The Transaction With Extra
// Care") and the next section's totals-table header ("Ope Bal Dr count Cr count...") landed
// concatenated onto the last transaction's own Particulars because neither was recognized as
// non-transaction text. Both must be stripped, leaving Particulars exactly as printed on the row.
test("page-boundary disclaimer and totals-header text never leak into a transaction's Particulars", () => {
  const statement = parseStatement(buildExtraction(page1Lines));
  const last = statement.transactions[statement.transactions.length - 1];
  assert.equal(last.particulars, "WDL TFR UPI 618485335555 302024333856@gbcb0000014.ifsc.npo TRF TO 0093123042928");
  assert.ok(!/Please Check|Ope Ball|Clo Bal/i.test(last.particulars));
});

// The bank re-prints "BROUGHT FORWARD" as every continuation page's own opening balance -- this
// must never be parsed as a 15th transaction. The footer's printed Dr count/Cr count/Debits/Credits
// /Clo Bal totals (only present on this later page, absent from page 1) must also be captured.
test("page-break BROUGHT FORWARD is skipped and the footer's printed totals are captured", () => {
  const statement = parseStatement(buildExtraction(footerPageLines));

  assert.equal(statement.transactions.length, 14);
  assert.ok(
    !statement.transactions.some((row) => /BROUGHT FORWARD/i.test(row.particulars)),
    "BROUGHT FORWARD page-break line must not appear as a transaction",
  );

  const last = statement.transactions[statement.transactions.length - 1];
  assert.equal(last.balance, 23108.86);
  assert.equal(last.withdrawal, 10000);

  assert.deepEqual(statement.printedTotals, {
    source: "printed",
    withdrawal: 930953.90,
    deposit: 621692.94,
    closingBalance: 23108.86,
  });
});

// Regression test against the *actual* raw OCR.space output for this continuation page (not a clean
// hand-typed fixture) -- covers a second round of row-level bugs found against a real pipeline run:
// the page's first two blocks dropped (a carried-forward cheque entry with no date, and the first
// dated row's own Post Date itself garbled), an amount/balance split across two lines, two rows with
// compound-garbled type codes leaking duplicated raw text into Particulars, and two rows whose Value
// Date was independently misread even though their Post Date read correctly.
test("real raw-OCR continuation page: carried-forward row, first dated row, and every value-mismatch row match reconciled ground truth", () => {
  const statement = parseStatement(buildExtraction(footerPageRealOcrLines));
  assert.equal(statement.detectedFormat, "greater-bombay");

  const rows = statement.transactions;
  assert.equal(rows.length, 15, "14 dated transactions plus the carried-forward row");

  // The carried-forward row: no date, no amount, just the previous page's last cheque's payee and
  // the resulting balance -- previously dropped entirely.
  assert.equal(rows[0].date, null);
  assert.equal(rows[0].balance, 47422.47);
  assert.ok(rows[0].particulars.includes("MOHIT TRADERS"));

  // The first *dated* row on the page: Post Date itself garbled ("29 / 07726"), previously dropped
  // along with the carried-forward row above it.
  assert.equal(rows[1].date.toISOString().slice(0, 10), "2026-07-29");
  assert.equal(rows[1].tranType, "CAS PRES CHQ");
  assert.equal(rows[1].chequeDetails, "259199");
  assert.equal(rows[1].withdrawal, 5427);
  assert.equal(rows[1].balance, 41995.47);

  const groundTruth = [
    { tranType: "DEP TFR", withdrawal: null, deposit: 27665.09, balance: 69660.56 },
    { tranType: "WDL TFR", withdrawal: 3610, deposit: null, balance: 66050.56 },
    { tranType: "WDL TFR", withdrawal: 3320, deposit: null, balance: 62730.56 },
    { tranType: "WDL TFR", withdrawal: 1080, deposit: null, balance: 61650.56 },
    { tranType: "WDL TFR", withdrawal: 420, deposit: null, balance: 61230.56 },
    { tranType: "TO TRANSFER", withdrawal: 118, deposit: null, balance: 61112.56 },
    { tranType: "DEP TFR", withdrawal: null, deposit: 750, balance: 61862.56 },
    { tranType: "CAS PRES CHQ", withdrawal: 29525, deposit: null, balance: 32337.56, chequeDetails: "260001" },
    { tranType: "DEP TFR", withdrawal: null, deposit: 14800.30, balance: 47137.86 },
    { tranType: "DEP TFR", withdrawal: null, deposit: 40, balance: 47177.86 },
    { tranType: "CAS PRES CHQ", withdrawal: 2898, deposit: null, balance: 44279.86, chequeDetails: "260003" },
    { tranType: "CAS PRES CHQ", withdrawal: 11171, deposit: null, balance: 33108.86, chequeDetails: "260002", valueDate: "2026-07-31" },
    { tranType: "WDL TFR", withdrawal: 10000, deposit: null, balance: 23108.86, valueDate: "2026-07-31" },
  ];

  groundTruth.forEach((truth, i) => {
    const row = rows[i + 2];
    assert.equal(row.tranType, truth.tranType, `row ${i + 2} tranType`);
    assert.equal(row.withdrawal, truth.withdrawal, `row ${i + 2} withdrawal`);
    assert.equal(row.deposit, truth.deposit, `row ${i + 2} deposit`);
    assert.equal(row.balance, truth.balance, `row ${i + 2} balance`);
    if (truth.chequeDetails) assert.equal(row.chequeDetails, truth.chequeDetails, `row ${i + 2} chequeDetails`);
    if (truth.valueDate) {
      assert.equal(row.valueDate.toISOString().slice(0, 10), truth.valueDate, `row ${i + 2} valueDate`);
      assert.equal(
        row.date.toISOString().slice(0, 10),
        row.valueDate.toISOString().slice(0, 10),
        `row ${i + 2} Date and Value Date must match`,
      );
    }
  });

  // No row's Particulars should contain a duplicated type-code token or a leaked balance/amount
  // fragment (the compound-garbled "DERI TER"/"HOL TER" rows previously duplicated their own raw
  // text into Particulars alongside the correctly-parsed Tran Type).
  for (const row of rows) {
    assert.ok(row.tranType || row.date === null, `row should have a recognized Tran Type: ${row.particulars}`);
  }
  assert.equal(rows[11].tranType, "DEP TFR"); // "DERI TER"
  assert.equal(rows[14].tranType, "WDL TFR"); // "HOL TER"
  assert.ok(!/DERI TER.*DERI TER|HOL TER.*HOL TER/.test(rows.map((r) => r.particulars).join(" | ")));

  assert.equal(statement.reconciliation.status, "PASS");
});

// A completely different Greater Bombay statement -- different branch (IFSC GBCB0000099, not
// ...014), different account number, different customer, a different month (October, not July),
// different amounts and cheque numbers throughout. Nothing in this fixture overlaps with the
// original sample; if detection or parsing were keyed off any value unique to that one file (rather
// than this bank's structural layout), this would fail to detect or would misparse.
test("a different account/branch/month statement in the same layout is detected and parsed generically", () => {
  const statement = parseStatement(buildExtraction(otherAccountLines));

  assert.equal(statement.detectedFormat, "greater-bombay");
  assert.equal(statement.transactions.length, 5);

  const expected = [
    { date: "2026-10-01", tranType: "DEP TFR", withdrawal: null, deposit: 9000, balance: 59000, chequeDetails: null },
    { date: "2026-10-05", tranType: "WDL TFR", withdrawal: 1500, deposit: null, balance: 57500, chequeDetails: null },
    { date: "2026-10-12", tranType: "CAS PRES CHQ", withdrawal: 6250.50, deposit: null, balance: 51249.50, chequeDetails: "400200" },
    { date: "2026-10-20", tranType: "BY TRANSFER", withdrawal: null, deposit: 800.25, balance: 52049.75, chequeDetails: null },
    { date: "2026-10-31", tranType: "TO TRANSFER", withdrawal: 45, deposit: null, balance: 52004.75, chequeDetails: null },
  ];

  expected.forEach((truth, index) => {
    const row = statement.transactions[index];
    assert.equal(row.date.toISOString().slice(0, 10), truth.date, `row ${index} date`);
    assert.equal(row.tranType, truth.tranType, `row ${index} tranType`);
    assert.equal(row.withdrawal, truth.withdrawal, `row ${index} withdrawal`);
    assert.equal(row.deposit, truth.deposit, `row ${index} deposit`);
    assert.equal(row.balance, truth.balance, `row ${index} balance`);
    assert.equal(row.chequeDetails || null, truth.chequeDetails, `row ${index} chequeDetails`);
  });

  assert.equal(statement.reconciliation.status, "PASS");
  assert.ok(statement.transactions[2].particulars.includes("UNRELATED"));
  assert.ok(statement.transactions[2].particulars.includes("SUPPLIERS PVT LTD"));
});
