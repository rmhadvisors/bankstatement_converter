import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");
const pdfPath = join(fixtureDir, "kotak-5611535323.pdf");
const expected = JSON.parse(readFileSync(join(fixtureDir, "kotak-5611535323-expected.json"), "utf8"));

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function findTransaction(transactions, match) {
  return transactions.find((row) => row.particulars.includes(match));
}

// Kotak's layout differs from TJSB/BCCB in three ways this fixture guards against:
// a leading serial-number column that isn't a row boundary signal, a single signed
// "DEBIT/CREDIT(₹)" column instead of separate debit/credit columns, and no trailing
// summary totals box at all (reconciliation must fall back to the row-by-row balance
// chain end-to-end).
test("Kotak 5611535323.pdf regression", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.transactions.length, expected.transactionCount);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(roundMoney(statement.reconciliation.calculatedClosingBalance), expected.calculatedClosingBalance);
  assert.equal(roundMoney(statement.reconciliation.statementClosingBalance), expected.statementClosingBalance);
  assert.equal(roundMoney(statement.reconciliation.closingDifference), 0);
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);

  for (const sample of expected.samples) {
    const row = findTransaction(statement.transactions, sample.match);
    assert.ok(row, `missing transaction matching "${sample.match}"`);

    assert.equal(row.date.toISOString().slice(0, 10), sample.date);
    assert.equal(row.withdrawal, sample.withdrawal);
    assert.equal(row.deposit, sample.deposit);
    assert.equal(roundMoney(row.balance), sample.balance);
    assert.ok(
      row.particulars.includes(sample.match),
      `expected narration to include "${sample.match}", got "${row.particulars}"`,
    );
  }

  // No row should ever carry both a withdrawal and a deposit: that would mean the
  // signed DEBIT/CREDIT column got split into two separate figures by mistake.
  const bothSet = statement.transactions.filter(
    (row) => row.withdrawal !== null && row.deposit !== null,
  );
  assert.equal(bothSet.length, 0, "some rows have both withdrawal and deposit set");

  if (expected.checks.balanceChainMismatches === 0) {
    let mismatches = 0;

    for (let index = 1; index < statement.transactions.length; index += 1) {
      const row = statement.transactions[index];
      const previous = statement.transactions[index - 1];
      if (row.balance === null || previous.balance === null) continue;

      const delta = roundMoney(row.balance - previous.balance);
      const expectedWithdrawal = delta < 0 ? Math.abs(delta) : 0;
      const expectedDeposit = delta > 0 ? delta : 0;
      const withdrawal = row.withdrawal || 0;
      const deposit = row.deposit || 0;

      if (
        Math.abs(withdrawal - expectedWithdrawal) > 0.02 ||
        Math.abs(deposit - expectedDeposit) > 0.02
      ) {
        mismatches += 1;
      }
    }

    assert.equal(mismatches, 0, "Debit/Credit amounts do not match the balance movement");
  }
});
