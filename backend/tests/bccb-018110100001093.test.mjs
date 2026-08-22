import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "fixtures", "bccb-018110100001093.pdf");

// Real 27-page Bassein Catholic Co-Op Bank "STATEMENT OF ACCOUNT" -- a continuous multi-line
// transaction table with no repeating page footer (only the column header repeats per page).
// This is the worst corruption case found across all bank profiles so far: dates were being
// fabricated outright (e.g. "31-01-2040") by a generic date-scavenging fallback seizing on an
// unrelated digit run once 2-3 real transactions got merged into one garbled row by a broken
// row-boundary detector, which also dropped ~90 real transactions and produced nonsense
// Withdrawal/Deposit/Type values from balance-delta guessing. See bccbLedgerParser.js for the
// fix: row boundaries are anchored strictly on each row's own two leading DD-MMM-YYYY dates, and
// Debit/Credit/Type are read directly from which of the source's own Debits/Credits columns is
// populated -- never inferred.
test("BCCB continuous-ledger statement extracts every row with no fabricated dates and reconciles exactly", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.detectedFormat, "bccb-ledger");

  // Ground truth: the PDF's own Statement Summary footer says Debit Count 159, Credit Count 245.
  assert.equal(statement.transactions.length, 404);
  assert.equal(statement.reviewRows.length, 0);

  // BUG 1 regression: no date may fall outside the statement's own stated period (01-Apr-2025 to
  // 31-Mar-2026) -- this used to include fabricated values like "31-01-2040" and "09-05-1993".
  const periodStart = new Date(Date.UTC(2025, 3, 1));
  const periodEnd = new Date(Date.UTC(2026, 2, 31));
  assert.ok(
    statement.transactions.every(
      (row) => row.date instanceof Date && row.date >= periodStart && row.date <= periodEnd,
    ),
  );

  // BUG 7: reconciles exactly against the statement's own printed Statement Summary figures.
  assert.equal(statement.reconciliation.openingBalance, 440463.4);
  assert.equal(statement.reconciliation.totalDebits, 4855652.73);
  assert.equal(statement.reconciliation.totalCredits, 4679390);
  assert.equal(statement.reconciliation.calculatedClosingBalance, 264200.67);
  assert.equal(statement.reconciliation.statementClosingBalance, 264200.67);
  assert.equal(statement.reconciliation.closingDifference, 0);
  assert.equal(statement.reconciliation.status, "PASS");

  const reconciliationErrors = statement.logs.filter(
    (log) => log.stage === "parse" && log.level === "error",
  );
  assert.deepEqual(reconciliationErrors, []);

  // BUG 2/4/5/6: the PDF's very first real transaction -- RTGS DR to Mandke Foundation, Debits
  // column 300,000.00, Credits column 0.00, REFF 000000000240 -- must land as exactly one row,
  // not merged with the RTGS CHARGES/GST rows that follow it.
  const first = statement.transactions[0];
  assert.equal(first.withdrawal, 300000);
  assert.equal(first.deposit, null);
  assert.equal(first.type, "DR");
  assert.equal(first.chequeNo, "000000000240");
  assert.match(first.particulars, /MANDKE FOUNDATION/);
  assert.doesNotMatch(first.particulars, /RTGS CHARGES/);
  assert.doesNotMatch(first.particulars, /GST/);

  const rtgsCharge = statement.transactions[1];
  assert.equal(rtgsCharge.particulars, "RTGS CHARGES");
  assert.equal(rtgsCharge.withdrawal, 25);
  assert.equal(rtgsCharge.type, "DR");
  // BUG 6: a fixed-charge line with no REFF in the source must be left blank, not a placeholder.
  assert.equal(rtgsCharge.chequeNo, null);

  const gstCharge = statement.transactions[2];
  assert.equal(gstCharge.particulars, "GST");
  assert.equal(gstCharge.withdrawal, 4.5);
  assert.equal(gstCharge.chequeNo, null);

  const chqPaid = statement.transactions[3];
  assert.equal(chqPaid.chequeNo, "000000000241");
  assert.equal(chqPaid.withdrawal, 15000);
  assert.equal(chqPaid.type, "DR");

  // A real credit row, for the Type/column-assignment regression in the other direction.
  const credit = statement.transactions[4];
  assert.equal(credit.chequeNo, "000000000241");
  assert.equal(credit.deposit, 53200);
  assert.equal(credit.withdrawal, null);
  assert.equal(credit.type, "CR");
});
