import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";

import { convertPdfToExcelBuffer } from "../src/parsers/converter.js";
import { parseAmountToken } from "../src/parsers/parsers/bccbPassbookParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 22 phone photos of a Bassein Catholic Co-op Bank passbook: image-only, skewed, out of order,
// mirrored bleed-through. The OCR.space result is cached next to it (*.pdf.ocr.json) so this runs
// offline and deterministically. Expected figures come from a verified manual conversion.
const pdfPath = join(__dirname, "fixtures", "bccb-passbook-photos.pdf");

test("BCCB passbook photos: 314 rows, opening 3017.58, closing 18060.12, every row reconciles", async () => {
  const { statement, buffer } = await convertPdfToExcelBuffer(pdfPath);
  const rows = statement.transactions;

  assert.equal(statement.detectedFormat, "bccb-passbook");
  assert.equal(rows.length, 314);
  assert.equal(statement.reconciliation.openingBalance, 3017.58);
  assert.equal(rows.at(-1).balance, 18060.12);

  let previous = 3017.58;
  for (const row of rows) {
    const expected = Math.round((previous - (row.withdrawal ?? 0) + (row.deposit ?? 0)) * 100) / 100;
    assert.equal(row.balance, expected, `row ${row.date?.toISOString().slice(0, 10)} ${row.particulars}`);
    assert.ok(row.date instanceof Date && row.date >= rows[0].date, "dates resolved and in order");
    previous = row.balance;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.getWorksheet("Statement of Account").rowCount, 1 + 314 + 1);
});

test("passbook amount tokens parse robustly", () => {
  assert.equal(parseAmountToken(".00"), 0);
  assert.equal(parseAmountToken("0.00"), 0);
  assert.equal(parseAmountToken("30000.00"), 30000);
  assert.equal(parseAmountToken("2000 : 00"), 2000);
  assert.equal(parseAmountToken("20 : 23 : 00"), 23);
  assert.equal(parseAmountToken(""), null);
  assert.equal(parseAmountToken(null), null);
  assert.equal(parseAmountToken("BCCB"), null);
});
