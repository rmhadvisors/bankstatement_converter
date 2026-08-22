import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "fixtures", "idbi-rep31-ledger.pdf");

// Real 14-page IDBI "REP31 Customer Account Ledger" report -- a repeating page-header/footer
// layout distinct from the single-page Finacle "Transaction Inquiry" format in idbiParser.js.
// This file used to have its "Page N" footer text misread as transaction amounts (12 fabricated
// rows, one per page break), boilerplate text bleeding into narrations, a synthesized opening
// balance of 1 (itself a page-number misread), and the first transaction after every page break
// landing in the wrong Debit/Credit column -- all while the final closing balance still happened
// to come out correct, masking the damage. See idbiLedgerParser.js for the fix.
test("IDBI REP31 ledger statement extracts every row cleanly and reconciles page-by-page", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.detectedFormat, "idbi-ledger");
  assert.equal(statement.pageCount, 14);

  // No fabricated rows from page-break boilerplate (was 12 extra rows, one per page break).
  assert.equal(statement.transactions.length, 569);

  // No boilerplate text (bank name, report title, B/F Balance, column headers, page totals) ever
  // leaked into a Particulars field.
  const boilerplatePattern =
    /IDBI BANK LTD|REP31|Service OutLet|Gl Sub Head Code|B\/F Balance|Peg Review date|Page Total|GL\. Value Tran Id/i;
  assert.ok(statement.transactions.every((row) => !boilerplatePattern.test(row.particulars || "")));

  // The real "Opening Balance : 3,13,304.67Cr" line, not the fabricated Balance=1 row.
  assert.equal(statement.reconciliation.openingBalance, 313304.67);
  assert.equal(statement.reconciliation.statementClosingBalance, 95359.28);
  assert.equal(statement.reconciliation.closingDifference, 0);

  // The statement's own printed Total Debit/Total Credit, not just a coincidentally-correct
  // closing balance -- this file's original bug left Withdrawal off by over 21 lakh while still
  // landing on the right final balance.
  assert.equal(statement.totals.withdrawal, 3248139.64);
  assert.equal(statement.totals.deposit, 3030194.25);
  assert.equal(statement.reconciliation.status, "PASS");

  // No page-subtotal or whole-statement reconciliation errors were raised.
  const reconciliationErrors = statement.logs.filter(
    (log) => log.stage === "parse" && log.level === "error",
  );
  assert.deepEqual(reconciliationErrors, []);

  // BUG 4 regression: six transactions immediately following a page break's "B/F Balance" line,
  // verified against the PDF's own Debit Amount column -- all six must land as Withdrawal, not
  // Deposit, now that boilerplate no longer leaks state into the next row's column decision.
  const debitAfterPageBreak = [
    ["2025-11-01", 24504, "SHAH SAROJBEN VINODCHANDRA"],
    ["2025-11-16", 5400, "MULTANI SAMIR"],
    ["2025-12-01", 13000, "GOVIND GAYRI"],
    ["2026-01-03", 18000, "MUKESH KUMAR PRAJAPAT"],
    ["2026-02-13", 15000, "NSW PIPES"],
    ["2026-03-16", 4182, "PUNIT ASHISH KINI"],
  ];
  for (const [isoDate, amount, name] of debitAfterPageBreak) {
    const row = statement.transactions.find(
      (candidate) =>
        candidate.date instanceof Date &&
        candidate.date.toISOString().slice(0, 10) === isoDate &&
        candidate.particulars.includes(name),
    );
    assert.ok(row, `expected a row for ${isoDate} / ${name}`);
    assert.equal(row.withdrawal, amount, `${isoDate} ${name} should be a Withdrawal`);
    assert.equal(row.deposit, null, `${isoDate} ${name} should not be a Deposit`);
  }

  // BUG 6: Tran Type classified from the narration prefix, and Cheque Details populated from the
  // Instrmnt Number column where present.
  const hitesh = statement.transactions.find((row) => row.particulars.includes("HITESH D JAIN"));
  assert.equal(hitesh.chequeNo, "M104921");
  assert.equal(hitesh.chequeDetails, "386031");
  assert.equal(hitesh.withdrawal, 40000);

  const smsCharge = statement.transactions.find((row) => row.particulars.startsWith("SMS_CHARGE"));
  assert.equal(smsCharge.tranType, "SMS_CHARGE");

  const intColl = statement.transactions.find((row) => row.particulars.startsWith("Int Coll"));
  assert.equal(intColl.tranType, "Int Coll");

  const byClg = statement.transactions.find((row) => row.particulars.startsWith("BY CLG"));
  assert.equal(byClg.tranType, "BY CLG");
  assert.equal(byClg.deposit, 5740);
});
