import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { extractPdf } from "../src/parsers/pdfExtractor.js";
import { parseStatement } from "../src/parsers/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");
const pdfPath = join(fixtureDir, "tjsb-011763.pdf");
const expected = JSON.parse(readFileSync(join(fixtureDir, "tjsb-011763-expected.json"), "utf8"));

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function findTransaction(transactions, match) {
  return transactions.find((row) => row.particulars.includes(match));
}

// TJSB's own column layout (Transaction Date | Description | Cheque No. | Debit | Credit |
// Balance), Indian-comma grouping, and "amount visually precedes its date/description in the
// PDF's text stream" quirk are exercised via the generic position-aware parser, not a
// bank-specific parser -- this is a regression fixture guarding that general path.
test("TJSB 011763.pdf loads via the generic position-aware parser (not a bank-specific one)", async () => {
  const extraction = await extractPdf(pdfPath);
  const statement = parseStatement(extraction);
  assert.equal(statement.detectedFormat, "generic");
});

test("TJSB 011763.pdf regression", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.transactions.length, expected.transactionCount);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(roundMoney(statement.reconciliation.openingBalance), expected.openingBalance);
  assert.equal(roundMoney(statement.reconciliation.calculatedClosingBalance), expected.closingBalance);
  assert.equal(roundMoney(statement.reconciliation.statementClosingBalance), expected.closingBalance);
  assert.equal(roundMoney(statement.reconciliation.closingDifference), 0);
  assert.equal(roundMoney(statement.reconciliation.totalDebits), expected.totalDebits);
  assert.equal(roundMoney(statement.reconciliation.totalCredits), expected.totalCredits);
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);

  for (const sample of expected.samples) {
    const row = findTransaction(statement.transactions, sample.match);
    assert.ok(row, `missing transaction matching "${sample.match}"`);

    assert.equal(row.date.toISOString().slice(0, 10), sample.date);
    assert.equal(roundMoney(row.withdrawal || 0), sample.withdrawal);
    assert.equal(roundMoney(row.deposit || 0), sample.deposit);
    assert.equal(roundMoney(row.balance), sample.balance);
    if (sample.chequeNo !== undefined) {
      assert.equal(row.chequeNo, sample.chequeNo);
    }
    assert.ok(
      row.particulars.includes(sample.match),
      `expected narration to include "${sample.match}", got "${row.particulars}"`,
    );
  }

  if (expected.checks.noFooterNoise) {
    const noisy = statement.transactions.filter((row) =>
      /transaction summary|total balance|page\s+\d+\s+of\s+\d+|gstin/i.test(row.particulars),
    );
    assert.equal(noisy.length, 0, "page footer / summary text leaked into narrations");
  }

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
