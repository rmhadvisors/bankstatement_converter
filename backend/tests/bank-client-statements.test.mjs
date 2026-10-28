import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

// Real client statements live in the git-ignored fixtures/bank/ folder; each test skips without its file.
// Expected figures are the statement's own printed totals.
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(__dirname, "fixtures", "bank", name);
const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + (row[key] || 0), 0) * 100) / 100;

const CASES = [
  {
    file: "axis_ambika_aug-oct26.pdf",
    format: "axis-report",
    rows: 627,
    debits: 6551660.13,
    credits: 7811508.0,
    closing: 1266824.79,
  },
  {
    file: "axis_shivshakti_aug-oct26.pdf",
    format: "axis-report",
    rows: 27,
    debits: 1388181.0,
    credits: 1401925.0,
    closing: 16401.3,
  },
];

for (const expected of CASES) {
  const path = fixture(expected.file);
  test(`client statement ${expected.file}: every row, printed totals and closing balance`, { skip: !existsSync(path) && `needs fixtures/bank/${expected.file}` }, async () => {
    const statement = await convertPdfToStatement(path);
    const rows = statement.transactions;

    assert.ok(statement.logs.some((log) => log.message === `Detected statement format: ${expected.format}.`));
    assert.equal(rows.length, expected.rows);
    assert.equal(sum(rows, "withdrawal"), expected.debits);
    assert.equal(sum(rows, "deposit"), expected.credits);
    assert.equal(rows.at(-1).balance, expected.closing);
    assert.equal(statement.reconciliation.status, "PASS");
    assert.ok(rows.every((row) => row.date instanceof Date && !/KANDIVALI|\[MH\]|\(\d{3,4}\)$/.test(row.particulars)));
  });
}
