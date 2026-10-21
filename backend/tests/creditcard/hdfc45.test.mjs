import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";

import { convertCreditCardToExcelBuffer } from "../../src/creditcard/ccConverter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(
  __dirname,
  "..",
  "fixtures",
  "creditcard",
  "HDFC_Credit_Card_Statement_45_Transactions.pdf",
);
const iso = (date) => date?.toISOString().slice(0, 10);

// One conversion shared by every test below.
const converted = convertCreditCardToExcelBuffer(pdfPath);

test("HDFC 45-transaction sample: rows read right to left as TYPE | AMOUNT | BALANCE", async () => {
  const { transactions } = (await converted).statement;
  assert.equal(transactions.length, 45);

  const [first, , payment] = transactions;
  assert.deepEqual(
    [iso(first.date), first.description, first.type, first.amount, first.balance],
    ["2026-10-01", "SWIGGY RESTAURANT GURGAON", "debit", 550, 290464.5],
  );
  assert.deepEqual(
    [iso(payment.date), payment.type, payment.amount, payment.balance],
    ["2026-10-02", "credit", 289914.5, 830],
  );
  assert.equal(transactions.at(-1).description, "AMAZON PAY BILLS - ELECTRICITY");
  assert.equal(transactions.filter((row) => row.type === "credit").length, 5);
  assert.equal(transactions.filter((row) => row.type === "debit").length, 40);
  assert.ok(transactions.every((row) => !/\b(?:Debit|Credit)\b|\d\.\d{2}/.test(row.description)));
});

test("HDFC 45-transaction sample: tax/EMI breakdown lines are Details, not rows or description", async () => {
  const { transactions } = (await converted).statement;
  const swiggy = transactions[0];
  assert.equal(swiggy.details, "Base: ₹523.81 | CGST (2.5%): ₹13.10 | SGST (2.5%): ₹13.10");
  const samsung = transactions.find((row) => row.description === "SAMSUNG MOBILE EMI 4/12");
  assert.equal(
    samsung.details,
    "Principal: ₹4,010.00 | Interest: ₹415.25 | GST on Interest: ₹74.75",
  );
  assert.equal(transactions.filter((row) => row.details).length, 8);
});

test("HDFC 45-transaction sample: running balance chain, totals, header fields, rewards, EMI table", async () => {
  const { summary, reconciliation, emiSummary } = (await converted).statement;

  assert.equal(reconciliation.totalDebits, 184271.82);
  assert.equal(reconciliation.totalCredits, 295714.5);
  assert.equal(reconciliation.runningBalance.checked, 45);
  assert.deepEqual(reconciliation.runningBalance.breaks, []);
  assert.equal(reconciliation.runningBalance.closingBalance, 178471.82);

  assert.equal(summary.cardHolder, "MAHI SHARMA");
  assert.equal(summary.cardLast4, "4821");
  assert.equal(summary.cardProduct, "REGALIA GOLD CREDIT CARD");
  assert.deepEqual([iso(summary.periodFrom), iso(summary.periodTo)], ["2026-10-01", "2026-10-31"]);
  assert.equal(iso(summary.paymentDueDate), "2026-11-20");
  assert.equal(summary.totalAmountDue, 168130);
  assert.equal(summary.minimumAmountDue, 8410);
  assert.equal(summary.previousBalance, 289914.5);
  assert.deepEqual(
    [
      summary.rewardPointsOpening,
      summary.rewardPointsEarned,
      summary.rewardPointsAdjusted,
      summary.rewardPointsClosing,
    ],
    [18050, 4210, 0, 22260],
  );

  assert.deepEqual(
    emiSummary.map((emi) => [emi.merchant, emi.tenure, emi.outstanding]),
    [
      ["SAMSUNG MOBILE FINANCED PURCHASE", "4/12", 32140],
      ["DELL LAPTOP STORE EMI CONVERSION", "2/6", 43200],
      ["WOODLAND FURNITURE EMI CONVERSION", "1/6", 23800],
    ],
  );
});

test("HDFC 45-transaction sample: the inconsistent printed summary is reported as such", async () => {
  const { reconciliation } = (await converted).statement;
  // The sample's own summary box (purchases 1,72,130 / total due 1,68,130) disagrees with its rows.
  assert.equal(reconciliation.status, "MISMATCH");
  assert.equal(reconciliation.warnings.length, 1);
  assert.match(
    reconciliation.warnings[0],
    /the statement's printed summary differs from its transactions by ₹10,341\.82 \(running balance verified row by row\)/,
  );
  assert.match(
    reconciliation.warnings[0],
    /transactions are verified; only the summary box disagrees/,
  );
});

test("HDFC 45-transaction sample: workbook columns, header block and sheets", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await converted).buffer);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["Transactions", "Summary", "EMI Summary"],
  );

  const sheet = workbook.getWorksheet("Transactions");
  assert.equal(sheet.getCell("A1").value, "MAHI SHARMA");
  assert.equal(sheet.getCell("A2").value, "HDFC Bank Regalia Gold Credit Card");
  assert.equal(sheet.getCell("A3").value, "Card: XXXX XXXX XXXX 4821");
  assert.match(sheet.getCell("A4").value, /Statement Period: 01\/10\/2026 to 31\/10\/2026/);
  assert.match(
    sheet.getCell("A5").value,
    /^WARNING: .*₹10,341\.82 \(running balance verified row by row\)/,
  );
  assert.deepEqual(sheet.getRow(6).values.slice(1), [
    "Date",
    "Description",
    "Ref No",
    "Card (last 4)",
    "Debit",
    "Credit",
    "Balance",
    "Foreign Amt",
    "Currency",
    "Details",
  ]);
  // Row 7 is the opening balance; the printed running balance is written as printed (no formula).
  assert.deepEqual(
    [sheet.getCell("B7").value, sheet.getCell("G7").value],
    ["Opening Balance (Previous Balance)", 289914.5],
  );
  assert.deepEqual(
    [
      sheet.getCell("B8").value,
      sheet.getCell("E8").value,
      sheet.getCell("F8").value,
      sheet.getCell("G8").value,
    ],
    ["SWIGGY RESTAURANT GURGAON", 550, null, 290464.5],
  );
  assert.deepEqual([sheet.getCell("E10").value, sheet.getCell("F10").value], [null, 289914.5]);
  assert.equal(sheet.getCell("G8").numFmt, "#,##0.00");
  assert.equal(sheet.getCell("G52").value, 178471.82, "closing = last printed balance");

  const summary = Object.fromEntries(
    workbook
      .getWorksheet("Summary")
      .getSheetValues()
      .filter(Boolean)
      .map((row) => [row[1], row[2]]),
  );
  assert.equal(summary["Card Holder"], "MAHI SHARMA");
  assert.equal(summary["Running Balance Check"], "Verified");
  assert.equal(summary["Closing Reward Points"], 22260);
  assert.equal(
    workbook.getWorksheet("EMI Summary").getCell("A4").value,
    "WOODLAND FURNITURE EMI CONVERSION",
  );
});
