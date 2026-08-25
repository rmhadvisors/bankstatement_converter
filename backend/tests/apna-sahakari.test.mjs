import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "fixtures", "apna-sahakari-cd243.pdf");

// Real 35-page Apna Sahakari Bank Ltd. "STATEMENT OF ACCOUNTS" (R045006), a born-digital CD
// (current) account statement with a genuine text layer (no OCR). Debit and Credit share one
// column pair with no per-row label -- see apnaSahakariParser.js for how a row's lone amount is
// assigned Dr vs Cr from its x-position against the header row's own column anchors, and how the
// running balance (which goes negative mid-statement here) is chain-validated row by row.
test("Apna Sahakari CD statement extracts every row and reconciles against the printed Totals row and balance chain", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.equal(statement.detectedFormat, "apna-sahakari");
  assert.equal(statement.transactions.length, 769);
  assert.equal(statement.reviewRows.length, 0);

  // Ground truth: the PDF's own "Totals / Balance :-" row.
  assert.equal(statement.reconciliation.openingBalance, 4475.91);
  assert.equal(statement.reconciliation.totalDebits, 4904019.92);
  assert.equal(statement.reconciliation.totalCredits, 4899547);
  assert.equal(statement.reconciliation.calculatedClosingBalance, 2.99);
  assert.equal(statement.reconciliation.statementClosingBalance, 2.99);
  assert.equal(statement.reconciliation.status, "PASS");

  const reconciliationErrors = statement.logs.filter((log) => log.stage === "parse" && log.level === "error");
  assert.deepEqual(reconciliationErrors, []);

  // Running balance goes negative mid-statement -- must not be misread as a magnitude.
  const negativeBalanceRows = statement.transactions.filter((row) => row.balance < 0);
  assert.equal(negativeBalanceRows.length, 4);
  assert.equal(negativeBalanceRows[0].balance, -14276.25);

  // A Cr-only row (no instrument): NEFT credit, no Dr Amount.
  const first = statement.transactions[0];
  assert.match(first.particulars, /NEFT STLMT FOR QR/);
  assert.equal(first.deposit, 1);
  assert.equal(first.withdrawal, null);
  assert.equal(first.chequeNo, null);
  assert.equal(first.balance, 4476.91);

  // A Dr-only row with an instrument ref, wrapped particulars glued back into one UPI reference.
  const upiCredit = statement.transactions[1];
  assert.equal(upiCredit.particulars, "UPI/CR/410720829797/CHAMPAK SUKHDEV/BACB/10210010");
  assert.equal(upiCredit.chequeNo, "410720829797");
  assert.equal(upiCredit.deposit, 1);
  assert.equal(upiCredit.withdrawal, null);

  const toSelf = statement.transactions[3];
  assert.equal(toSelf.particulars, "TO SELF");
  assert.equal(toSelf.chequeNo, "100001");
  assert.equal(toSelf.withdrawal, 90000);
  assert.equal(toSelf.deposit, null);

  // Indian lakh/crore comma grouping parses correctly (not mistaken for Western 3-digit grouping).
  const last = statement.transactions[statement.transactions.length - 1];
  assert.equal(last.withdrawal, 3000);
  assert.equal(last.balance, 2.99);
});
