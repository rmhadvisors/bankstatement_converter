import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { buildWorkbookBuffer } from "../src/parsers/excelWriter.js";
import { hdfc3241OcrLines } from "./fixtures/hdfc-3241-ocr-lines.mjs";

const XLSX = await import("xlsx");

function buildExtraction(lines) {
  return {
    lines,
    text: lines.map((line) => line.text).join("\n"),
    pageCount: new Set(lines.map((line) => line.pageNumber)).size,
    source: "ocr",
  };
}

// Regression test for a real pipeline failure on HDFC_3241.pdf (63 pages, only page 1 had any
// embedded PDF text; pages 2-63 were bare scanned images with none at all). Two bugs compounded:
// (1) converter.js's OCR fallback only triggered when the WHOLE document had zero embedded text,
// so page 1's own (garbled) text layer masked the fact that every other page was silently never
// read; (2) once routed through this app's own OCR.space pass, the column header prints once, as
// a single merged line ("Date Narration Chq./Ref.No. ... Closing Balance"), which detectColumnAnchors
// only recognized when each column name was its own whole line -- so it always fell back to a
// pixel-scale default hundreds of times smaller than this scan's real (300 DPI) coordinate space,
// misclassifying every cell and producing garbage dates/amounts.
test("pipeline resolves a multi-page-scanned HDFC statement into a structured, row-accurate result", () => {
  const statement = parseStatement(buildExtraction(hdfc3241OcrLines));

  assert.equal(statement.detectedFormat, "hdfc-ocr");
  assert.equal(statement.transactions.length, 18);

  const first = statement.transactions[0];
  assert.equal(first.date.toISOString().slice(0, 10), "2025-04-02");
  assert.equal(first.particulars, "UPI - AMAN ASLAM MUNSHI - 7786002100 @ AXL - UTI B0000036 - 102475013651 - 120 PAYMENT MH43AW");
  assert.equal(first.withdrawal, 50000);
  assert.equal(first.deposit, null);
  assert.equal(first.balance, 55594.14);
  assert.equal(first.tranType, "UPI");
  assert.equal(first.chequeNo, "0000102475013651");
  assert.equal(first.type, "CR");

  const cc = statement.transactions.find((t) => t.tranType === "CC");
  assert.ok(cc, "expected the CC AUTOPAY row's leading token to be read as Tran Type");

  const interestlike = statement.transactions.find((t) => /DREAM11/.test(t.particulars));
  assert.equal(interestlike.tranType, "UPI");
});

// The specific artifact this format's OCR pass produces: a transaction's Withdrawal Amt. cell can
// land on the row's own first line (NEXASPHERE) or arrive ONLY as a stray trailing line below the
// wrapped narration (TESLAQ), sometimes duplicated onto both. Trusting that cell's own value
// (rather than the balance delta) produced wrong amounts whenever it was stale/duplicated from a
// neighboring row; the balance chain is self-verifying and was made authoritative instead.
test("withdrawal/deposit amount is derived from the balance delta, not a possibly-duplicated amount cell", () => {
  const statement = parseStatement(buildExtraction(hdfc3241OcrLines));

  const nexasphere = statement.transactions.find((t) => /NEXASPHERE/.test(t.particulars));
  assert.equal(nexasphere.withdrawal, 500);
  assert.equal(nexasphere.balance, 9090.34);

  const teslaq = statement.transactions.find((t) => /TESLAQ/.test(t.particulars));
  assert.equal(teslaq.withdrawal, 500, "balance delta (9090.34 -> 8590.34) wins over the stray '1,000.00' trailing cell");
  assert.equal(teslaq.balance, 8590.34);
});

// Every page repeats the full account letterhead (branch, address, phone, email, IFSC...), not
// just page 1, and a transaction's own narration can still be open when that block starts right
// after a page break. None of that letterhead text -- nor the bare "HDFC BANK" page-top wordmark
// this fixture's page 2 boundary crosses -- may leak into any row's particulars.
test("the repeated per-page account letterhead never leaks into transaction particulars", () => {
  const statement = parseStatement(buildExtraction(hdfc3241OcrLines));

  for (const transaction of statement.transactions) {
    assert.doesNotMatch(transaction.particulars, /HDFC BANK/i);
    assert.doesNotMatch(transaction.particulars, /Account Branch/i);
    assert.doesNotMatch(transaction.particulars, /Statement of account/i);
  }
});

// This scan's own Statement Summary shape: "Dr Count Cr Count Debits Credits Closing Bal" prints
// BEFORE "Opening Balance" (reversed from the other two shapes this parser already handled), the
// five values (opening, Dr count, Cr count, debits, credits) arrive on one dense line, and Closing
// Bal is split onto its own line after that.
test("printed totals are read from this scan's reversed-label Statement Summary block", () => {
  const statement = parseStatement(buildExtraction(hdfc3241OcrLines));

  assert.equal(statement.printedTotals.withdrawal, 2993226.4);
  assert.equal(statement.printedTotals.deposit, 2905992.35);
  assert.equal(statement.printedTotals.closingBalance, 18360.09);

  const interest = statement.transactions.find((t) => /INTEREST PAID/.test(t.particulars));
  assert.ok(interest, "expected the closing INTEREST PAID TILL row");
  assert.equal(interest.tranType, "INTEREST PAID");
  assert.equal(interest.balance, 18360.09);
  assert.equal(interest.type, "CR");
});

test("Excel output is a single bare 'Statement of Account' sheet with Tran Type/Tran ID/Type populated", async () => {
  const statement = parseStatement(buildExtraction(hdfc3241OcrLines));
  const buffer = await buildWorkbookBuffer(statement);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  assert.deepEqual(workbook.SheetNames, ["Statement of Account"]);
  const sheet = workbook.Sheets["Statement of Account"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 1, defval: null });

  assert.equal(rows.length, 19); // 18 transaction rows + 1 trailing GRAND TOTAL row
  const firstRow = rows[0];
  assert.equal(firstRow[3], "UPI"); // Tran Type
  assert.equal(firstRow[4], "0000102475013651"); // Tran ID
  assert.equal(firstRow[9], "CR"); // Type

  const totalRow = rows[rows.length - 1];
  assert.equal(totalRow[2], "GRAND TOTAL");
});
