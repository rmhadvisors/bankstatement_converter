import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import ExcelJS from "exceljs";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { buildWorkbookBuffer } from "../src/parsers/excelWriter.js";
import { parseAmountText } from "../src/parsers/hdfcWordBoxParser.js";
import { parseTesseractTsv } from "../src/parsers/ocrExtractor.js";

// 94 MB / 231 pages, too big for the repo. Vector-drawn text (no text layer) except June/July,
// 12 monthly HDFC statements in two layouts.
const SAMPLE = process.env.HDFC_MERGED_PDF || "C:/Users/HP/Downloads/APRIL 25 TO MAR 26 MERGED.pdf";

test("OCR amount cleanup keeps sign, needs exactly two decimals", () => {
  assert.equal(parseAmountText("853,284.69)"), 853284.69);
  assert.equal(parseAmountText("9,24 ,989.69"), 924989.69);
  assert.equal(parseAmountText("-35,740.00"), -35740);
  assert.ok(Number.isNaN(parseAmountText("1,234.5")));
  assert.ok(Number.isNaN(parseAmountText("1.234.56")));
});

test("tesseract TSV parsing keeps word boxes only", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "4\t1\t1\t1\t1\t0\t10\t20\t300\t30\t-1\t",
    "5\t1\t1\t1\t1\t1\t317\t1260\t160\t30\t96.5\t01/04/2025",
    "5\t1\t1\t1\t1\t2\t549\t1260\t20\t30\t95\t ",
  ].join("\n");
  assert.deepEqual(parseTesseractTsv(tsv), [{ text: "01/04/2025", left: 317, top: 1260, width: 160, height: 30 }]);
});

test(
  "HDFC merged Apr 2025 - Mar 2026 (231 pages, two layouts) reconciles every month",
  { skip: !existsSync(SAMPLE), timeout: 60 * 60 * 1000 },
  async () => {
    const statement = await convertPdfToStatement(SAMPLE);
    const real = statement.transactions;

    assert.equal(statement.detectedFormat, "hdfc-wordbox");
    assert.equal(real.length, 2270);
    assert.equal(statement.printedTotals.openingBalance, 674429.21);
    assert.equal(real[0].date.toISOString().slice(0, 10), "2025-04-01");
    assert.equal(real.at(-1).date.toISOString().slice(0, 10), "2026-03-31");
    assert.equal(real.at(-1).balance, 2636994.22);
    assert.equal(statement.totals.withdrawal, 52915993.84);
    assert.equal(statement.totals.deposit, 54878558.85);

    const expected = [
      ["Apr 2025", 191, 720489.54],
      ["May 2025", 192, 744762.88],
      ["Jun 2025", 172, 1323239.65],
      ["Jul 2025", 191, 2022531.31],
      ["Aug 2025", 167, 2605318.39],
      ["Sep 2025", 171, 1458410.35],
      ["Oct 2025", 202, 1389523.76],
      ["Nov 2025", 198, 992705.15],
      ["Dec 2025", 211, 1450912.5],
      ["Jan 2026", 191, 587248.57],
      ["Feb 2026", 170, 274510.02],
      ["Mar 2026", 214, 2636994.22],
    ];
    assert.deepEqual(
      statement.monthlyCheck.map((month) => [month.month, month.transactions, month.closing]),
      expected,
    );
    for (const month of statement.monthlyCheck) {
      assert.equal(month.status, "MATCH", `${month.month} does not match its printed summary`);
      assert.equal(month.balanceBreaks, 0, `${month.month} has running-balance breaks`);
    }
    assert.ok(!real.some((row) => row.hadOcrCorrection), "no amount should need balance-chain correction");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildWorkbookBuffer(statement));
    const sheet = workbook.getWorksheet("Monthly Check");
    assert.ok(sheet, "Monthly Check sheet is present");
    assert.equal(sheet.rowCount, 13);
    assert.equal(sheet.getRow(13).getCell(16).value, "MATCH");
  },
);
