import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { parseAmount } from "../src/parsers/parsers/drCrPassbookParser.js";
import { fixtureGate } from "./helpers/fixtureGate.mjs";

test("passbook OCR amounts: stray separators, glued fragments, non-amounts", () => {
  assert.equal(parseAmount("12,26_759_00"), 1226759);
  assert.equal(parseAmount("4.00.000_00"), 400000);
  assert.equal(parseAmount("400000-00"), 400000);
  assert.equal(parseAmount("9636.00"), 9636);
  assert.equal(parseAmount("04-03-2024"), null);
  assert.equal(parseAmount("126834"), null);
  assert.equal(parseAmount("5.06,38206084.00"), null, "too long to be a balance");
});

// Client passbook (5 phone photos, two of them the same page), git-ignored; the OCR.space answer is cached next to it.
const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bank", "bassein-drcr-passbook-5pages.pdf");
const gate = fixtureGate("bank/bassein-drcr-passbook-5pages.pdf", path);

test("DR/CR passbook photos: duplicate pages merged, every value on the balance chain", { skip: gate.skip, timeout: 60_000 }, async () => {
  gate.assertPresent();
  const statement = await convertPdfToStatement(path, { scanned: true });
  const rows = statement.transactions;

  assert.equal(statement.detectedFormat, "drcr-passbook");
  assert.equal(rows.length, 24);
  assert.equal(statement.reconciliation.openingBalance, 9572);
  assert.equal(rows.at(-1).balance, 1183379);
  let previous = 9572;
  for (const row of rows) {
    assert.equal(Math.round((previous - (row.withdrawal ?? 0) + (row.deposit ?? 0)) * 100) / 100, row.balance, `${row.particulars}`);
    previous = row.balance;
  }
  // The misread "7,515.06", "692.00" and "17555.00" came out as 7,515 / 12,11,692 / 13,555.
  assert.deepEqual(rows.filter((row) => [226759, 1226759, 1211692, 13555].includes(row.balance)).map((row) => row.balance), [13555, 1211692, 1226759]);
  // Only dates the photo does not show legibly are left for a person (never guessed): all are named.
  assert.equal(statement.review.status, "needs_review");
  assert.ok(statement.review.reasons.every((reason) => /^date unreadable/.test(reason)), statement.review.reasons.join("\n"));
});
