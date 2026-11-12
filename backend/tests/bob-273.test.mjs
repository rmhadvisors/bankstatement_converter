import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";

import { convertPdfToExcelBuffer } from "../src/parsers/converter.js";
import { fixtureGate } from "./helpers/fixtureGate.mjs";

// BOB supply-chain-finance overdraft (Dr balances, withdrawals/deposits by column, browser-print footers).
// Client PDF, git-ignored: skipped when absent.
const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bank", "BOB-273.pdf");
const gate = fixtureGate("bank/BOB-273.pdf", path);

test("BOB-273 overdraft statement", { skip: gate.skip, timeout: 120_000 }, async () => {
  gate.assertPresent();
  const { buffer, statement } = await convertPdfToExcelBuffer(path);
  const rows = statement.transactions.filter((row) => row.particulars !== "B/F");
  const sum = (key) => Math.round(rows.reduce((total, row) => total + (row[key] || 0), 0) * 100) / 100;

  assert.equal(statement.review.status, "ok");
  assert.equal(rows.length, 131);
  assert.equal(statement.reconciliation.openingBalance, -9066889.82);
  assert.equal(sum("withdrawal"), 24581278.56);
  assert.equal(sum("deposit"), 24984780.95);
  assert.equal(rows.at(-1).balance, -8663387.43);
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0, "balance breaks");
  assert.equal(rows.filter((row) => /Transaction Details|https?:|^\d+$/.test(row.particulars) || row.date.getUTCFullYear() !== 2026).length, 0, "footer junk rows");
  // Column position decides the side: the first row is a deposit although the Dr balance fell.
  assert.deepEqual([rows[0].withdrawal, rows[0].deposit], [null, 334762.7]);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const total = workbook.worksheets[0].lastRow.values.slice(1);
  assert.deepEqual([total[2], total[6], total[7], total[8]], ["GRAND TOTAL", 24581278.56, 24984780.95, -8663387.43]);
});
