import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";
import { buildWorkbookBuffer } from "../src/parsers/excelWriter.js";
import { unionBank571301010050303Lines } from "./fixtures/union-bank-571301010050303-lines.mjs";

const XLSX = await import("xlsx");

function buildExtraction() {
  return {
    lines: unionBank571301010050303Lines,
    text: unionBank571301010050303Lines.map((line) => line.text).join("\n"),
    pageCount: 7,
    source: "pdf",
  };
}

// Regression test for a real pipeline failure: this Union Bank of India statement has a genuine,
// clean native PDF text layer (pdfjs extracts it perfectly -- see the fixture), but a beneficiary's
// "Beneficiary Bank HDFC BANK LTD" reference sub-field, combined with the generic phrase "STATEMENT
// OF ACCOUNT" every bank's letterhead uses, was enough to false-positive-match hdfcOcrParser.js's
// isHdfcOcrLayout (it scanned the WHOLE document for a stray "HDFC BANK" mention, not just this
// document's own letterhead). That routed a perfectly good text-layer PDF into hdfcOcrParser, which
// found nothing (wrong layout entirely), which tripped converter.js's "zero transactions -> retry
// with OCR" fallback -- sending clean, selectable PDF text through OCR.space's image pipeline for no
// reason, corrupting digits and swapping Latin letters for Cyrillic look-alikes in the process.
test("pipeline resolves Union Bank of India as its own format, never touching OCR", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.detectedFormat, "union-bank");
  assert.equal(statement.ocrSourced, false);
  assert.equal(statement.transactions.length, 219);
});

// Balance-chain validation: every row's stated balance must equal the previous row's balance plus
// deposit minus withdrawal, and the final row must match the statement's own printed closing
// balance. This is the non-negotiable QA gate -- a parsing bug here must surface as a flagged row,
// never a silently-wrong balance.
test("balance chain reconciles exactly, opening to closing, with zero flagged rows", () => {
  const statement = parseStatement(buildExtraction());

  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.openingBalance, 196645.22);
  assert.equal(statement.reconciliation.calculatedClosingBalance, 31424.17);
  assert.equal(statement.reconciliation.statementClosingBalance, 31424.17);
  assert.equal(statement.reconciliation.closingDifference, 0);
  assert.equal(statement.reconciliation.transactionCount, 219);
  assert.deepEqual(statement.reconciliation.suspiciousTransactions, []);
  assert.equal(statement.reviewRows.length, 0);
});

// GRAND TOTAL must equal the sum of its own column's rows, not the bank's own printed "Cumulative
// Totals" figure verbatim -- this statement's own footer folds the opening balance into the
// Deposits total (confirmed: printed deposits minus opening balance equals the sum of every
// deposit row exactly), which unionBankParser.js corrects before it reaches the workbook.
test("printed totals are corrected for this statement's opening-balance-in-deposits quirk", () => {
  const statement = parseStatement(buildExtraction());

  let withdrawalSum = 0;
  let depositSum = 0;
  for (const transaction of statement.transactions) {
    withdrawalSum += transaction.withdrawal || 0;
    depositSum += transaction.deposit || 0;
  }

  assert.equal(Math.round(withdrawalSum * 100) / 100, statement.totals.withdrawal);
  assert.equal(Math.round(depositSum * 100) / 100, statement.totals.deposit);
  assert.equal(statement.totals.withdrawal, 6496226.27);
  assert.equal(statement.totals.deposit, 6331005.22);
  assert.equal(statement.totals.closingBalance, 31424.17);
});

// Multi-line transaction grouping: an RTGS row's UTR Number/Sender Account/Sender IFSC/Sender
// Bank/Sender Branch continuation lines must all fold into ONE row (never split into separate rows,
// never dropped), with the UTR captured as this row's own reference/Tran ID.
test("a multi-line RTGS transaction and its reference sub-fields become exactly one row", () => {
  const statement = parseStatement(buildExtraction());
  const rtgs = statement.transactions.find((t) => /AARTI DRUGS LIMITED KKBK110425646863/.test(t.particulars));

  assert.ok(rtgs, "expected the AARTI DRUGS RTGS row");
  assert.equal(rtgs.date.toISOString().slice(0, 10), "2025-04-11");
  assert.equal(rtgs.deposit, 439431.82);
  assert.equal(rtgs.withdrawal, null);
  assert.equal(rtgs.balance, 606368.04);
  assert.equal(rtgs.chequeNo, "KKBKR22025041116646863", "UTR Number becomes this row's Tran ID");
  assert.match(rtgs.particulars, /Sender Account: 313390080/);
  assert.match(rtgs.particulars, /Sender IFSC: KKBK0000958/);
  assert.match(rtgs.particulars, /Sender Bank: KOTAK MAHINDRA BANK/);
  assert.match(rtgs.particulars, /Sender Branch: MUMBAI-NPT/);

  const noneOtherHasThisUtr = statement.transactions.filter((t) => t.chequeNo === "KKBKR22025041116646863");
  assert.equal(noneOtherHasThisUtr.length, 1, "the continuation lines must not have become a separate row");
});

// Spot-check five narrations char-for-char against the PDF's own text layer (see the fixture
// comment -- extracted verbatim, not hand-transcribed), covering the format's main shapes: a plain
// UPI debit, a UPI credit, a bank charge line, and two of the recurring quarterly SMS-charge rows.
test("five narrations match the source PDF's text layer character-for-character", () => {
  const statement = parseStatement(buildExtraction());
  const find = (particulars) => statement.transactions.find((t) => t.particulars === particulars);

  assert.ok(find("UPIAR/102491503860/DR/Shivshak/UTIB/gpay-112531535"));
  assert.ok(find("UPIAB/509717020535/CR/RUPESH J/UTIB/rupeshsankhe22"));
  assert.ok(find("Charges for PORD Customer Payment:UBINJ25109618520"));
  assert.ok(find("Sms Charges For June Qtr ,2025"));
  assert.ok(find("Sms Charges For Mar Qtr ,2026"));
});

test("Excel output is a single bare 'Statement of Account' sheet with a trailing GRAND TOTAL row", async () => {
  const statement = parseStatement(buildExtraction());
  const buffer = await buildWorkbookBuffer(statement);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  assert.deepEqual(workbook.SheetNames, ["Statement of Account"]);
  const sheet = workbook.Sheets["Statement of Account"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 1, defval: null });

  assert.equal(rows.length, 220); // 219 transaction rows + 1 trailing GRAND TOTAL row
  const totalRow = rows[rows.length - 1];
  assert.equal(totalRow[2], "GRAND TOTAL");
  assert.equal(Math.round((totalRow[6] || 0) * 100) / 100, 6496226.27);
  assert.equal(Math.round((totalRow[7] || 0) * 100) / 100, 6331005.22);
  assert.equal(totalRow[8], 31424.17);
});
