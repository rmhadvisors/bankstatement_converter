import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "fixtures", "bccb-june-26.pdf");

// BCCB's scan has confirmed column-major OCR misordering, so this statement is handled by
// a manually verified transcription bypass (verifiedStatements/bccbJune2026.js) rather than
// the generic parser. This fixture guards that the bypass still triggers and both accounts'
// printed Statement Summary reconciliation keeps passing as the generic parser evolves.
test("BCCB june-26.pdf regression (verified-transcription bypass)", async () => {
  const statement = await convertPdfToStatement(pdfPath);

  assert.ok(Array.isArray(statement.accounts), "expected the multi-account BCCB bypass path");
  assert.equal(statement.accounts.length, 2);

  const account1 = statement.accounts.find((account) => account.accountNo === "015110100001621");
  const account2 = statement.accounts.find((account) => account.accountNo === "015110100001635");

  assert.ok(account1, "missing account 015110100001621");
  assert.ok(account2, "missing account 015110100001635");

  assert.equal(account1.transactions.length, 37);
  assert.equal(account2.transactions.length, 36);

  assert.equal(account1.reconciliationPassed, true);
  assert.equal(account2.reconciliationPassed, true);
});
