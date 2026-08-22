import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "fixtures", "icici-9043-detailed.pdf");

// Real 8-page ICICI "Detailed Statement" (multi-page, wrapped-cell table layout, regular Cr
// account) that used to lose two whole pages of rows silently, invert every balance's sign, and
// swap the Withdrawal/Deposit columns -- see the file header comment in iciciDetailedParser.js
// for the root causes. This is the permanent regression fixture guarding all of that.
test("ICICI 9043 detailed statement extracts every row and reconciles to the printed closing balance", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.detectedFormat, "icici-detailed");

  // Ground truth: the PDF's own "Sl No" column runs 1-104 with no gaps.
  assert.equal(statement.transactions.length, 104);

  // Every balance must be the positive figure printed in the PDF (this is a regular current
  // account, not an OD account) -- none of them silently negated.
  assert.ok(statement.transactions.every((row) => row.balance === null || row.balance > 0));

  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.openingBalance, 5357.37);
  assert.equal(statement.reconciliation.calculatedClosingBalance, 1656155.37);
  assert.equal(statement.reconciliation.statementClosingBalance, 1656155.37);
  assert.equal(statement.reconciliation.closingDifference, 0);
  assert.equal(statement.reconciliation.totalDebits, 392420);
  assert.equal(statement.reconciliation.totalCredits, 2043218);

  // Sl No 84: "CASH PAID:SELF" withdrawal of 3,70,000.00 with an explicit Cheque/Ref No of 564 --
  // exercises the Withdrawal/Deposit split, the Cheque/Ref column, and Tran Type inference.
  const cashPaid = statement.transactions[83];
  assert.equal(cashPaid.withdrawal, 370000);
  assert.equal(cashPaid.deposit, null);
  assert.equal(cashPaid.chequeNo, "564");
  assert.equal(cashPaid.tranType, "CASH");
  assert.equal(cashPaid.balance, 1282171.37);
});
