import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { isBankOfBarodaSavingsLayout } from "../src/parsers/bobParser.js";
import { extractPdf } from "../src/parsers/pdfExtractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");
const pdfPath = join(fixtureDir, "bob-7593.pdf");
const expected = JSON.parse(readFileSync(join(fixtureDir, "bob-7593-expected.json"), "utf8"));

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function findTransaction(transactions, match) {
  return transactions.find((row) => row.particulars.includes(match));
}

// Regression test for a second, distinct Bank of Baroda savings-account statement template
// ("DATE PARTICULARS CHQ.NO. WITHDRAWALS DEPOSITS BALANCE") that the original bobParser.js only
// recognized for the business-account template ("TRAN DATE VALUE DATE NARRATION ..."). Before this
// was wired in, this layout matched neither BOB detector, the generic parser found 0 transactions
// from the native text, and the "0 transactions -> retry with OCR" fallback in converter.js sent a
// fully text-native 9-page PDF through OCR.Space/Tesseract -- taking minutes and surfacing as a
// 502 at any reverse proxy. This test guards against that regressing.
test("Bank of Baroda 7593.pdf (savings layout) detection", async () => {
  const extraction = await extractPdf(pdfPath);
  assert.equal(isBankOfBarodaSavingsLayout(extraction.lines), true);
});

test("Bank of Baroda 7593.pdf (savings layout) regression", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.detectedFormat, "bank-of-baroda-savings");
  assert.equal(statement.transactions.length, expected.transactionCount);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(roundMoney(statement.reconciliation.openingBalance), expected.openingBalance);
  assert.equal(roundMoney(statement.reconciliation.calculatedClosingBalance), expected.closingBalance);

  const totalWithdrawal = statement.transactions.reduce((sum, row) => sum + (row.withdrawal || 0), 0);
  const totalDeposit = statement.transactions.reduce((sum, row) => sum + (row.deposit || 0), 0);
  assert.equal(roundMoney(totalWithdrawal), expected.totalWithdrawal);
  assert.equal(roundMoney(totalDeposit), expected.totalDeposit);

  for (const sample of expected.samples) {
    const row = findTransaction(statement.transactions, sample.match);
    assert.ok(row, `missing transaction matching "${sample.match}"`);

    assert.equal(row.date.toISOString().slice(0, 10), sample.date);
    assert.equal(row.withdrawal, sample.withdrawal);
    assert.equal(row.deposit, sample.deposit);
    assert.equal(roundMoney(row.balance), roundMoney(sample.balance));
  }

  // Guards against the repeated-letterhead/footer boilerplate leaking into narration text, which
  // happened for the last transaction on each page before the noise-line filters were fixed.
  const polluted = statement.transactions.filter((row) => row.particulars.length > 100);
  assert.equal(polluted.length, 0, "boilerplate leaked into a transaction's particulars");
});
