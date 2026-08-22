import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { isBankOfBarodaLayout } from "../src/parsers/bobParser.js";
import { extractPdf } from "../src/parsers/pdfExtractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");
const pdfPath = join(fixtureDir, "bob-502.pdf");
const expected = JSON.parse(readFileSync(join(fixtureDir, "bob-502-expected.json"), "utf8"));

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function findTransaction(transactions, match) {
  return transactions.find((row) => row.particulars.includes(match));
}

test("Bank of Baroda 502.pdf layout detection", async () => {
  const extraction = await extractPdf(pdfPath);
  assert.equal(isBankOfBarodaLayout(extraction.lines), true);
});

test("Bank of Baroda 502.pdf regression", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.transactions.length, expected.transactionCount);

  for (const sample of expected.samples) {
    const row = findTransaction(statement.transactions, sample.match);
    assert.ok(row, `missing transaction matching "${sample.match}"`);

    assert.equal(row.date.toISOString().slice(0, 10), sample.date);
    assert.equal(row.withdrawal, sample.withdrawal);
    assert.equal(row.deposit, sample.deposit);
    assert.equal(roundMoney(row.balance), roundMoney(sample.balance));
    assert.ok(
      row.particulars.includes(sample.match),
      `expected narration to include "${sample.match}", got "${row.particulars}"`,
    );
  }

  if (expected.checks.noFooterNoise) {
    const noisy = statement.transactions.filter((row) =>
      /contact-us@|page\s+\d+\s+of\s+\d+/i.test(row.particulars),
    );
    assert.equal(noisy.length, 0, "page footer text leaked into narrations");
  }

  if (expected.checks.noOpeningBalanceGarbage) {
    const garbage = statement.transactions.filter((row) =>
      /^OPENING BALANCE \d/i.test(row.particulars),
    );
    assert.equal(garbage.length, 0, "split UPI rows were parsed as opening balance");
  }

  if (expected.checks.balanceChainMismatches === 0) {
    let mismatches = 0;

    for (let index = 0; index < statement.transactions.length - 1; index += 1) {
      const row = statement.transactions[index];
      const older = statement.transactions[index + 1];
      if (row.balance === null || older.balance === null) continue;

      const delta = roundMoney(row.balance - older.balance);
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

    assert.equal(mismatches, 0, "DR/CR amounts do not match the balance movement");
  }
});
