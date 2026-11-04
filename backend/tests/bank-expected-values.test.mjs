import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { normalizeDescription } from "../src/parsers/guards.js";
import { fixtureGate } from "./helpers/fixtureGate.mjs";

// One data-driven check per real client statement, from the git-ignored fixtures/bank/client-statements.json
// (the statement's own printed figures and rows). Any change to a parser that alters row count, totals,
// opening/closing balance, the first/last row or a named row fails here. Descriptions are compared with the
// spacing around "/" normalised, so wrapping or join spacing cannot break a comparison.
//
// A case with "pending" is a known failure that waits for a fix: it runs as a node:test `todo` (reported,
// does not fail the run) and the reason is printed in the test name. Remove "pending" when the fix lands.
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bank");
const specPath = join(dir, "client-statements.json");
const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + (row[key] || 0), 0) * 100) / 100;
const iso = (row) => row.date.toISOString().slice(0, 10);

const hasTesseract = (() => {
  try {
    execFileSync(process.env.TESSERACT_PATH || (process.platform === "win32" ? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe" : "tesseract"), ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// expected: { date?, particulars?, chequeNo?, tranId?, withdrawal?, deposit?, balance? } -- only the listed fields are compared.
function assertRow(row, expected, label) {
  assert.ok(row, `${label}: row not found`);
  if (expected.date !== undefined) assert.equal(iso(row), expected.date, `${label} date`);
  if (expected.particulars !== undefined) assert.equal(normalizeDescription(row.particulars), normalizeDescription(expected.particulars), `${label} description`);
  for (const key of ["chequeNo", "tranId", "withdrawal", "deposit", "balance"]) if (expected[key] !== undefined) assert.equal(row[key] ?? null, expected[key], `${label} ${key}`);
}

const specGate = fixtureGate("bank/client-statements.json", specPath);
if (!existsSync(specPath)) test("bank expected-values file client-statements.json", { skip: specGate.skip }, () => specGate.assertPresent());
const cases = existsSync(specPath) ? JSON.parse(readFileSync(specPath, "utf8")).cases : [];

for (const c of cases) {
  const path = join(dir, c.file);
  const gate = fixtureGate(`bank/${c.file}`, path, { tool: c.needsTesseract ? ["the tesseract binary", hasTesseract] : null });
  const name = `expected values ${c.file}${c.pending ? ` (pending: ${c.pending})` : ""}`;
  test(name, { skip: gate.skip, todo: c.pending || false, timeout: 10 * 60 * 1000 }, async () => {
    gate.assertPresent();
    const statement = await convertPdfToStatement(path);
    const rows = statement.transactions;

    assert.equal(statement.detectedFormat, c.format, "layout");
    assert.equal(rows.length, c.rows, "row count");
    assert.equal(sum(rows, "withdrawal"), c.debits, "total debits");
    assert.equal(sum(rows, "deposit"), c.credits, "total credits");
    if (c.opening !== undefined) assert.equal(statement.reconciliation.openingBalance, c.opening, "opening balance");
    assert.equal(rows.at(-1).balance, c.closing, "closing balance");
    if (c.first) assertRow(rows[0], c.first, "first row");
    if (c.last) assertRow(rows.at(-1), c.last, "last row");

    for (const check of c.rowChecks ?? []) {
      const found = rows.filter((row) => iso(row) === check.find.date && row.balance === check.find.balance);
      assert.equal(found.length, 1, `row ${check.find.date} balance ${check.find.balance}: expected exactly one, found ${found.length}`);
      assertRow(found[0], check.expect, `row ${check.find.date} balance ${check.find.balance}`);
    }
    if (c.chequeNos) assert.deepEqual(rows.map((row) => row.chequeNo), c.chequeNos, "cheque numbers");
    for (const [index, particulars] of Object.entries(c.particulars ?? {})) assert.equal(normalizeDescription(rows[index].particulars), normalizeDescription(particulars), `row ${index} description`);
    for (const [index, [withdrawal, deposit]] of Object.entries(c.amounts ?? {})) assert.deepEqual([rows[index].withdrawal, rows[index].deposit], [withdrawal, deposit], `row ${index} amounts`);
    for (const pattern of c.particularsNeverMatch ?? []) assert.ok(rows.every((row) => !new RegExp(pattern).test(row.particulars)), `no description matches /${pattern}/`);

    assert.equal(statement.reconciliation.status, "PASS", "reconciliation");
    assert.deepEqual(statement.review, { status: "ok", reasons: [] }, "review status");
  });
}
