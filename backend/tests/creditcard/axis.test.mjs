import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";

import {
  buildCardStatement,
  convertCreditCardStatement,
} from "../../src/creditcard/ccConverter.js";
import { buildCreditCardWorkbookBuffer } from "../../src/creditcard/ccExcelWriter.js";
import { axisSelectLines } from "../fixtures/creditcard/axis-select-redacted-lines.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The real statement is customer data: never committed. Drop it in backend/tmp/ (gitignored) to run
// the PDF-level check too.
const realPdf = join(__dirname, "..", "..", "tmp", "Axis - Credit Card PSW-DEVE4297_unlocked.pdf");
const iso = (date) => date?.toISOString().slice(0, 10);
const CATEGORY_WORDS =
  /\b(?:EDUCATION|MISCELLANEOUS|DEPT STORES|CLOTH STORES|FUEL|RESTAURANTS|MISC STORE)$/;

function assertAxisStatement({ summary, transactions, reconciliation }) {
  assert.equal(transactions.length, 34);

  const first = transactions[0];
  assert.deepEqual(
    [iso(first.date), first.description, first.category, first.type, first.amount],
    ["2026-05-25", "PAYPAL *VOICESFDYFW,4029357733", "EDUCATION", "debit", 5054.31],
  );
  const byDescription = (text) => transactions.find((row) => row.description === text);
  assert.equal(byDescription("AVENUE SUPERMARTS LTD,THANE").category, "DEPT STORES");
  assert.equal(byDescription("PAYPAL *NECONNECTED,35314369001").category, "MISC STORE");
  assert.equal(byDescription("DEBIT INTEREST").category, "", "rows without a category stay blank");

  const payment = transactions.find((row) => row.description.startsWith("MB PAYMENT #"));
  assert.deepEqual(
    [iso(payment.date), payment.type, payment.amount],
    ["2026-05-28", "credit", 194242.28],
  );

  const last = transactions.at(-1);
  assert.deepEqual(
    [iso(last.date), last.description, last.type, last.amount],
    ["2026-06-13", "FUEL CASHBACK REBATES", "credit", 25.02],
  );
  for (const row of transactions) assert.doesNotMatch(row.description, CATEGORY_WORDS);

  // Page 3's worked examples ("Rs. 25000.00", "3.75% p.m.") must not leak into the summary.
  assert.equal(summary.previousBalance, 189723.02);
  assert.equal(summary.financeCharges, undefined);
  assert.deepEqual(
    [
      summary.paymentsCredits,
      summary.otherCredits,
      summary.purchasesDebits,
      summary.cashAdvance,
      summary.otherDebits,
      summary.totalAmountDue,
      summary.minimumAmountDue,
    ],
    [194242.28, 3096.69, 73281.55, 0, 7534.24, 73199.84, 5642],
  );
  assert.equal(iso(summary.statementDate), "2026-06-13");
  assert.deepEqual([iso(summary.periodFrom), iso(summary.periodTo)], ["2026-05-15", "2026-06-13"]);
  assert.equal(iso(summary.paymentDueDate), "2026-07-03");
  assert.deepEqual(
    [summary.creditLimit, summary.availableCreditLimit, summary.availableCashLimit],
    [383000, 309800.16, 10300],
  );
  assert.equal(summary.rewardPointsClosing, 110210);
  assert.equal(iso(summary.rewardPointsAsOf), "2026-06-11");
  assert.equal(summary.cardProduct, "SELECT credit card");

  assert.equal(reconciliation.totalDebits, 80815.79);
  assert.equal(reconciliation.totalCredits, 197338.97);
  assert.equal(reconciliation.closingBalance, 73199.84);
  assert.equal(reconciliation.status, "OK");
  assert.deepEqual(reconciliation.warnings, []);
  assert.ok(reconciliation.checks.every((check) => check.difference === 0));
}

test("Axis SELECT (redacted lines): rows, categories, page-1-only summary, reconciliation", () => {
  const statement = buildCardStatement(axisSelectLines);
  assertAxisStatement(statement);
  assert.equal(statement.summary.cardHolder, "RAVI SHARMA");
  assert.equal(statement.summary.cardLast4, "1111");
});

test("Axis SELECT (redacted lines): Category column, opening row and computed balance formulas", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await buildCreditCardWorkbookBuffer(buildCardStatement(axisSelectLines)),
  );
  const sheet = workbook.getWorksheet("Transactions");

  assert.equal(sheet.getCell("A5").value, null, "no warning banner");
  assert.deepEqual(sheet.getRow(6).values.slice(1), [
    "Date",
    "Description",
    "Category",
    "Ref No",
    "Card (last 4)",
    "Debit",
    "Credit",
    "Balance (computed)",
    "Foreign Amt",
    "Currency",
  ]);

  // Row 7: the opening balance; rows 8..41: the 34 transactions; H = balance.
  assert.equal(sheet.getCell("B7").value, "Opening Balance (Previous Balance)");
  assert.equal(sheet.getCell("H7").value, 189723.02);
  assert.deepEqual(
    [sheet.getCell("B8").value, sheet.getCell("C8").value, sheet.getCell("F8").value],
    ["PAYPAL *VOICESFDYFW,4029357733", "EDUCATION", 5054.31],
  );
  assert.deepEqual(sheet.getCell("H8").value, { formula: "H7+F8-G8", result: 194777.33 });
  assert.match(sheet.getCell("B14").value, /^MB PAYMENT #/);
  assert.deepEqual(
    [sheet.getCell("G14").value, sheet.getCell("H14").value.result],
    [194242.28, 7708.85],
  );
  assert.deepEqual(
    [sheet.getCell("B41").value, sheet.getCell("G41").value, sheet.getCell("H41").value.result],
    ["FUEL CASHBACK REBATES", 25.02, 73199.84],
  );

  const summary = Object.fromEntries(
    workbook
      .getWorksheet("Summary")
      .getSheetValues()
      .filter(Boolean)
      .map((row) => [row[1], row[2]]),
  );
  assert.equal(summary["Previous Balance"], 189723.02);
  assert.ok("Finance Charges (printed)" in summary, "row is present");
  assert.equal(summary["Finance Charges (printed)"] ?? null, null, "not printed -> blank");
  assert.equal(summary["Cash Advance (printed)"], 0);
  assert.equal(summary["Other Debits & Charges (printed)"], 7534.24);
  assert.equal(summary["Other Credits (printed)"], 3096.69);
  assert.equal(summary["Available Cash Limit"], 10300);
  assert.equal(summary["Closing Reward Points"], 110210);
  assert.equal(iso(summary["Reward Points As On"]), "2026-06-11");
  assert.deepEqual(summary["Closing Balance (last row)"], {
    formula: "Transactions!H41",
    result: 73199.84,
  });
  assert.deepEqual(summary["Total Debits (parsed)"], {
    formula: "SUM(Transactions!F8:F41)",
    result: 80815.79,
  });
  assert.equal(summary["Reconciliation Status"], "OK");
});

test(
  "Axis SELECT (real PDF in tmp/): same result straight from the PDF",
  { skip: !existsSync(realPdf) && "put the unlocked Axis PDF in backend/tmp/ to run" },
  async () => {
    const statement = await convertCreditCardStatement(realPdf);
    assertAxisStatement(statement);
    assert.equal(statement.transactions[6].description, "MB PAYMENT #O3AEEV6G9CGVKF");
  },
);
