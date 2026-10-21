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
import { idfcMayuraLines } from "../fixtures/creditcard/idfc-mayura-redacted-lines.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The real statement is customer data: never committed. Drop it in backend/tmp/ to run the
// PDF-level checks too (tmp/ is gitignored).
const realPdf = join(__dirname, "..", "..", "tmp", "IDFC PSW-0201_unlocked.pdf");
const iso = (date) => date?.toISOString().slice(0, 10);

const EXPECTED = [
  ["2026-07-01", "Credit Card Payment Received", "credit", 156449.75, undefined],
  ["2026-07-03", "AHREFS.COM, SINGAPORE", "debit", 12307.87, ["USD", 129]],
  ["2026-07-10", "Fiverr.com, NICOSIA", "debit", 26390, undefined],
  ["2026-07-13", "Payoneer.com, 1000000003", "debit", 23856.33, ["USD", 250]],
  ["2026-07-22", "Interest charges for JULY-2026 Statement", "debit", 10219.27, undefined],
  ["2026-07-22", "SGST", "debit", 919.73, undefined],
  ["2026-07-22", "CGST", "debit", 919.73, undefined],
];

function assertIdfcStatement(statement) {
  const { summary, transactions, reconciliation } = statement;

  assert.deepEqual(
    transactions.map((row) => [
      iso(row.date),
      row.description,
      row.type,
      row.amount,
      row.foreignCurrency ? [row.foreignCurrency, row.foreignAmount] : undefined,
    ]),
    EXPECTED,
  );
  assert.deepEqual(
    transactions.map((row) => row.emiEligible),
    [false, true, true, true, false, false, false],
  );
  for (const row of transactions) {
    assert.doesNotMatch(row.description, /Convert|Payment Modes|Pay through/);
  }

  assert.equal(summary.issuer, "IDFC FIRST Bank");
  assert.equal(summary.cardProduct, "Mayura Credit Card");
  assert.deepEqual([iso(summary.periodFrom), iso(summary.periodTo)], ["2026-06-23", "2026-07-22"]);
  assert.equal(iso(summary.statementDate), "2026-07-22");
  assert.equal(iso(summary.paymentDueDate), "2026-08-06");
  assert.deepEqual([summary.minimumAmountDue, summary.totalAmountDue], [17310, 274612.93]);
  assert.deepEqual(
    [
      summary.previousBalance,
      summary.purchasesDebits,
      summary.otherDebits,
      summary.paymentsCredits,
      summary.otherCredits,
    ],
    [356449.75, 62554.2, 12058.73, 156449.75, 0],
  );
  assert.deepEqual(
    [
      summary.creditLimit,
      summary.availableCreditLimit,
      summary.cashLimit,
      summary.availableCashLimit,
    ],
    [352000, 77387.07, 35200, 35200],
  );
  assert.deepEqual(
    [
      summary.rewardPointsOpening,
      summary.rewardPointsEarned,
      summary.rewardPointsBonus,
      summary.rewardPointsAdjusted,
      summary.rewardPointsClosing,
    ],
    [14449, 2706, 0, 0, 17155],
  );

  assert.equal(reconciliation.totalDebits, 74612.93);
  assert.equal(reconciliation.totalCredits, 156449.75);
  assert.equal(reconciliation.status, "OK");
  assert.deepEqual(reconciliation.warnings, []);
  assert.ok(reconciliation.checks.every((check) => check.difference === 0));
}

test("IDFC FIRST Mayura (redacted lines): transactions, summary and reconciliation", () => {
  const statement = buildCardStatement(idfcMayuraLines);
  assertIdfcStatement(statement);
  assert.equal(statement.summary.cardHolder, "RAVI KUMAR SHARMA");
  assert.equal(statement.summary.cardLast4, "1111");
  assert.ok(statement.transactions.every((row) => row.cardLast4 === "1111"));
});

test("IDFC FIRST Mayura (redacted lines): workbook has no warning banner and a 0.00 check", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await buildCreditCardWorkbookBuffer(buildCardStatement(idfcMayuraLines)),
  );

  const sheet = workbook.getWorksheet("Transactions");
  assert.equal(sheet.getCell("A1").value, "RAVI KUMAR SHARMA");
  assert.equal(sheet.getCell("A2").value, "IDFC FIRST Bank Mayura Credit Card");
  assert.match(sheet.getCell("A4").value, /Statement Period: 23\/06\/2026 to 22\/07\/2026/);
  assert.equal(sheet.getCell("A5").value, null, "no warning banner");
  // No printed running balance: computed from the opening balance, as formulas (G = Balance).
  assert.equal(sheet.getCell("G6").value, "Balance (computed)");
  assert.equal(sheet.getCell("G7").value, 356449.75);
  assert.deepEqual(sheet.getCell("G14").value, { formula: "G13+E14-F14", result: 274612.93 });

  const summary = Object.fromEntries(
    workbook
      .getWorksheet("Summary")
      .getSheetValues()
      .filter(Boolean)
      .map((row) => [row[1], row[2]]),
  );
  assert.equal(summary["Other Debits & Charges (printed)"], 12058.73);
  assert.equal(summary["Closing Balance (last row)"].result, 274612.93);
  assert.equal(summary["Other Credits (printed)"], 0);
  assert.equal(summary["Credit Limit"], 352000);
  assert.equal(summary["Reconciliation Status"], "OK");
  assert.match(summary["Reconciliation Check"].formula, /^ROUND\(/);

  let text = "";
  workbook.eachSheet((ws) =>
    ws.eachRow((row) => row.eachCell((cell) => (text += ` ${cell.text}`))),
  );
  assert.doesNotMatch(
    text,
    /400000|\*{6}|1000000001|20000000000002/,
    "no full card, CRN or account number",
  );
});

test(
  "IDFC FIRST Mayura (real PDF in tmp/): same result straight from the PDF",
  { skip: !existsSync(realPdf) && "put IDFC PSW-0201_unlocked.pdf in backend/tmp/ to run" },
  async () => {
    const statement = await convertCreditCardStatement(realPdf);
    statement.transactions[3].description = statement.transactions[3].description.replace(
      /, \d+$/,
      ", 1000000003",
    );
    assertIdfcStatement(statement);
  },
);
