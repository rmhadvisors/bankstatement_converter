import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { parseStatement } from "../src/parsers/parser.js";
import { fixtureGate } from "./helpers/fixtureGate.mjs";

// Three statement layouts that used to fall through to the generic parser and fail (or scramble) the
// conversion. Each synthetic statement below copies the real layout (column x-positions, wrapped
// descriptions, page headers/footers, the printed summary) with made-up names and numbers, so no client
// data is in the repo. Real-file checks at the bottom run only when the PDFs are in the git-ignored
// fixtures/bank/ folder.

// A text line as the PDF extractor delivers it: [[x, text], ...]
const line = (...items) => ({ text: items.map(([, text]) => text).join(" "), items: items.map(([x, text]) => ({ x, text })) });
const statement = (lines, source = "pdf") => parseStatement({ lines, text: lines.map((l) => l.text).join("\n"), pageCount: 2, source });
const money = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Bank of India "Statement of Account": SNO | TRAN DATE | INST NO | DESCRIPTION | DEBITS | CREDITS | BALANCE Cr.
// It was read as a generic table: the SNO/instrument number landed in the amount columns and the opening
// balance came out as 216,335. IFSC is printed "IFSC CODE : BKID...", which the old detector missed.
// ---------------------------------------------------------------------------------------------
const boiHeader = line([34, "SNO"], [71, "TRAN DATE"], [157, "INST NO"], [303, "DESCRIPTION"], [482, "DEBITS"], [558, "CREDITS"], [666, "BALANCE"]);
const boiPage = (rows) => [line([28, "Statement of Account"], [200, "000100000001"], [300, "FROM"], [330, "01-04-2025 TO 31-03-2026"]), boiHeader, ...rows];

test("Bank of India SNO layout: instrument no., description-only rows, 0.00 sides, Cr. balance, page break", () => {
  const lines = [
    line([28, "Bank Of India"], [200, "TEST BRANCH"]),
    line([33, "IFSC CODE :"], [259, "BKID0000000"]),
    line([33, "OPENING BALANCE:"], [259, "10000.00Cr."]),
    ...boiPage([
      line([42, "1"], [74, "05-04-2025"], [161, "100001"], [265, "CASH TO TEST PERSON"], [498, "2000.00"], [601, "0.00"], [707, "8000.00"], [749, "Cr."]),
      line([42, "2"], [74, "30-04-2025"], [290, "NET_PEN_APR2025"], [521, "0.00"], [578, "5000.00"], [701, "13000.00"], [749, "Cr."]),
      line([42, "3"], [74, "02-05-2025"], [248, "000100000001:SBInt.Pd:01-02-2025"], [521, "0.00"], [589, "100.50"], [701, "13100.50"], [749, "Cr."]),
      line([248, "WRAPPED TEXT"]),
      line([300, "Page:"], [330, "1"]),
    ]),
    ...boiPage([line([39, "4"], [74, "15-05-2025"], [161, "100002"], [315, "TO CASH"], [498, "100.50"], [601, "0.00"], [707, "13000.00"], [749, "Cr."])]),
    line([28, "This is a system generated statement and does not require any signature."]),
  ];
  const s = statement(lines);
  assert.equal(s.detectedFormat, "bank-of-india");
  assert.equal(s.transactions.length, 4);
  assert.equal(s.reconciliation.status, "PASS");
  assert.equal(s.reconciliation.openingBalance, 10000);
  assert.equal(s.reconciliation.calculatedClosingBalance, 13000);
  const [a, b, c, d] = s.transactions;
  assert.deepEqual([a.chequeNo, a.particulars, a.withdrawal, a.deposit, a.balance], ["100001", "CASH TO TEST PERSON", 2000, null, 8000]);
  assert.deepEqual([b.chequeNo, b.particulars, b.withdrawal, b.deposit], [null, "NET_PEN_APR2025", null, 5000]);
  assert.equal(c.particulars, "000100000001:SBInt.Pd:01-02-2025 WRAPPED TEXT", "wrapped text joins the row, the page footer does not");
  assert.deepEqual([d.particulars, d.withdrawal], ["TO CASH", 100.5], "the repeated page header does not leak into the row");
});

// ---------------------------------------------------------------------------------------------
// Bassein Catholic Co-op Bank (BCCB) internet-banking "Account Statement": the description wraps over
// several lines, only one of Debit / Credit is printed (by column), the reference number has no decimals,
// small charges print without a leading zero (".80"), and the last page prints an Account Summary.
// ---------------------------------------------------------------------------------------------
const bccbHeader = [line([28, "Account Statement"]), line([34, "Transaction"], [91, "Description"], [190, "Reference Number"], [309, "Value Date"], [360, "Debit"], [431, "Credit"], [502, "Balance"]), line([34, "Date"])];
const bccbRow = (date, desc, ref, side, amount, balance) => line([29, date], [86, desc], [185, ref], [304, date], [side === "debit" ? 360 : 431, amount], [502, balance]);

test("BCCB account statement: column-based debit/credit, wrapped descriptions, '.80' amounts, page footer, printed summary", () => {
  const lines = [
    line([28, "Account Statement"]),
    line([28, "IFSC Code / MICR Code"], [200, "BACB0000000 / 400000000"]),
    ...bccbHeader,
    bccbRow("01 Apr 2026", "UPI/", "120000000001", "credit", "480.00", "10,480.00"),
    line([86, "CR/120000000001/"]),
    line([86, "TEST PAYER/"]),
    bccbRow("02 Apr 2026", "UPI/", "120000000002", "debit", "1,000.00", "9,480.00"),
    line([86, "DR/120000000002/"]),
    bccbRow("03 Apr 2026", "SMS CHARGE", "SCREF00000000001", "debit", ".80", "9,479.20"),
    line([33, "1"], [52, "03 Nov 2026, 18:54"]),
    ...bccbHeader,
    bccbRow("03 Apr 2026", "GST", "BACB2600000000001R", "debit", ".14", "9,479.06"),
    bccbRow("04 Apr 2026", "UPI/", "120000000003", "credit", "5.00", "9,484.06"),
    line([86, "CR/120000000003/"]),
    line([28, "Account Summary:"]),
    line([29, "Opening Balance"], [185, "10,000.00"], [375, "You may E-Mail us on :"]),
    line([29, "Closing Balance"], [185, "9,484.06"]),
    line([29, "Total Debit Amount"], [185, "1,000.94"]),
    line([29, "Total Credit Amount"], [185, "485.00"]),
    line([29, "Total Number of Debits"], [185, "3"]),
    line([29, "Total Number of Credits"], [185, "2"]),
    line([28, "**This is a computer generated statement and does not require a signature."]),
  ];
  const s = statement(lines);
  assert.equal(s.detectedFormat, "bccb-account-statement");
  assert.equal(s.transactions.length, 5, "the '.80' and '.14' charges are read, not skipped");
  assert.equal(s.reconciliation.status, "PASS");
  assert.equal(s.reconciliation.openingBalance, 10000, "derived from the first row, equals the printed opening");
  assert.deepEqual([s.printedTotals.withdrawal, s.printedTotals.deposit, s.printedTotals.closingBalance], [1000.94, 485, 9484.06]);
  assert.deepEqual(s.transactions.map((t) => [t.withdrawal, t.deposit]), [[null, 480], [1000, null], [0.8, null], [0.14, null], [null, 5]]);
  assert.equal(s.transactions[0].particulars, "UPI/ CR/120000000001/ TEST PAYER/");
  assert.equal(s.transactions[0].chequeNo, "120000000001", "the reference number is the cheque/ref column, never an amount");
  assert.equal(s.transactions[2].particulars, "SMS CHARGE", "the page footer after a row is not added to its description");
  assert.equal(money(s.transactions.reduce((n, t) => n + (t.withdrawal ?? 0), 0)), 1000.94);
});

test("BCCB account statement: a row whose amounts cannot be read is reported, never silently dropped", () => {
  const lines = [
    line([28, "IFSC Code / MICR Code"], [200, "BACB0000000 / 400000000"]),
    ...bccbHeader,
    bccbRow("01 Apr 2026", "UPI/", "120000000001", "credit", "480.00", "10,480.00"),
    line([29, "02 Apr 2026"], [86, "UPI/"], [185, "120000000002"], [304, "02 Apr 2026"]),
  ];
  const s = statement(lines);
  assert.equal(s.detectedFormat, "bccb-account-statement");
  assert.equal(s.transactions.length, 1);
  assert.ok(s.logs.some((l) => l.level === "error" && /no readable amount/.test(l.message)));
});

// ---------------------------------------------------------------------------------------------
// HDFC Bank statement with a text layer: the narration wraps BELOW its dated row (the generic parser put
// the last narration lines on the NEXT row), amounts are right-aligned (their x start varies), the bank
// hard-wraps long UPI strings, and the last page prints a STATEMENT SUMMARY with Dr/Cr counts.
// ---------------------------------------------------------------------------------------------
const hdfcHeader = line([40, "Date"], [144, "Narration"], [284, "Chq./Ref.No."], [362, "Value Dt"], [405, "Withdrawal Amt."], [491, "Deposit Amt."], [564, "Closing Balance"]);
const hdfcRow = (narration, ref, side, x, amount, balanceX, balance) => line([34, "01/04/26"], [72, narration], [289, ref], [362, "01/04/26"], [x, amount], [balanceX, balance]);

test("HDFC text-layer statement: wrapped narration stays with its row, right-aligned debit/credit, summary counts", () => {
  const lines = [
    line([28, "RTGS/NEFT IFSC : HDFC0000000"], [300, "MICR : 400000000"]),
    hdfcHeader,
    hdfcRow("UPI-TEST PAYER ONE", "0000111111111111", "debit", 452, "55.00", 605, "945.00"),
    line([68, "NAIR-TESTVPA1-5@OKICI"]),
    line([72, "CI-UBIN0532061-111111111111-UP"]),
    line([72, "I"]),
    hdfcRow("UPI-TESTNAME SINGH-9999999999@AXL-SBIN00", "0000222222222222", "credit", 526, "525.00", 599, "1,470.00"),
    line([72, "00000-222222222222-PAYMENT FROM PHONE"]),
    line([28, "HDFC BANK LIMITED"]),
    line([28, "*Closing balance includes funds earmarked for hold and uncleared funds"]),
    line([292, "Page No .: 2"]),
    line([340, "Account Branch : TEST"]),
    line([34, "MS."], [58, "TEST HOLDER"]),
    hdfcRow("NEFT CR-TEST0000001-SOME PARTY", "TEST000000000001", "credit", 516, "12,345.00", 595, "13,815.00"),
    hdfcRow("UPI-TEST SHOP-TESTSHOP@OKSBI-TEST0000002-333333333333-UPI", "0000333333333333", "debit", 442, "1,000.00", 595, "12,815.00"),
    line([28, "STATEMENT SUMMARY :-"]),
    line([30, "Opening Balance Dr Count Cr Count Debits Credits Closing Bal"]),
    line([30, "1,000.00 2 2 1,055.00 12,870.00 12,815.00"]),
    line([28, "HDFC BANK LIMITED"]),
  ];
  const s = statement(lines);
  assert.equal(s.detectedFormat, "hdfc-statement");
  assert.equal(s.transactions.length, 4);
  assert.equal(s.reconciliation.status, "PASS");
  assert.equal(s.reconciliation.openingBalance, 1000);
  assert.deepEqual(s.transactions.map((t) => [t.withdrawal, t.deposit]), [[55, null], [null, 525], [null, 12345], [1000, null]]);
  // first line short -> a word break (space), later wraps -> hard breaks (no space)
  assert.equal(s.transactions[0].particulars, "UPI-TEST PAYER ONE NAIR-TESTVPA1-5@OKICICI-UBIN0532061-111111111111-UPI");
  // first line full (40 chars) -> hard break
  assert.equal(s.transactions[1].particulars, "UPI-TESTNAME SINGH-9999999999@AXL-SBIN0000000-222222222222-PAYMENT FROM PHONE");
  assert.equal(s.transactions[1].chequeNo, "0000222222222222");
  assert.equal(s.transactions[2].particulars, "NEFT CR-TEST0000001-SOME PARTY", "the page header/footer is not added to a narration");
  assert.deepEqual([s.printedTotals.withdrawal, s.printedTotals.deposit, s.printedTotals.closingBalance], [1055, 12870, 12815]);
});

test("HDFC statement parser only takes text-layer PDFs; a count that differs from the printed summary is an error", () => {
  const base = [line([28, "HDFC BANK LIMITED"]), hdfcHeader, hdfcRow("UPI-TEST", "0000111111111111", "debit", 452, "55.00", 605, "945.00")];
  const summary = [line([28, "STATEMENT SUMMARY :-"]), line([30, "Opening Balance Dr Count Cr Count Debits Credits Closing Bal"]), line([30, "1,000.00 2 0 55.00 0.00 945.00"])];
  const s = statement([...base, ...summary]);
  assert.equal(s.detectedFormat, "hdfc-statement");
  assert.ok(s.logs.some((l) => l.level === "error" && /prints 2 debits but 1 were read/.test(l.message)));
  assert.notEqual(statement(base, "ocr").detectedFormat, "hdfc-statement");
});

// ---------------------------------------------------------------------------------------------
// The real statements, when their PDFs are in the git-ignored fixtures/bank/ folder.
// ---------------------------------------------------------------------------------------------
const real = (name) => decodeURIComponent(new URL(`./fixtures/bank/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

// The expected figures of the real statements are client data: they live in the git-ignored
// fixtures/bank/client-statements.json ("layoutFixtures"), never in this file. A missing JSON or PDF skips with the
// loud "SKIPPED N client fixtures" line; REQUIRE_FIXTURES=1 (npm run test:full) makes it a failure.
const specPath = real("client-statements.json");
const specGate = fixtureGate("bank/client-statements.json", specPath);
const layoutFixtures = existsSync(specPath) ? (JSON.parse(readFileSync(specPath, "utf8")).layoutFixtures ?? []) : [];

if (!layoutFixtures.length) {
  test("real layout fixtures: expected figures in client-statements.json (layoutFixtures)", { skip: specGate.skip }, () => {
    specGate.assertPresent();
    assert.fail("client-statements.json has no layoutFixtures entries");
  });
}

// f: { file, format, rows, opening?, closing?, debits?, credits?, env?, upiRows? }  (env = the variable holding the PDF password)
for (const f of layoutFixtures) {
  const gate = f.env
    ? fixtureGate(`bank/${f.file} (+ env ${f.env})`, real(f.file), { tool: [`the ${f.env} env var`, Boolean(process.env[f.env])] })
    : fixtureGate(`bank/${f.file}`, real(f.file));
  test(`real statement ${f.file} (${f.format}) reconciles against its printed figures`, { skip: gate.skip, timeout: 5 * 60 * 1000 }, async () => {
    gate.assertPresent();
    const s = await convertPdfToStatement(real(f.file), f.env ? { password: process.env[f.env] } : {});
    assert.equal(s.detectedFormat, f.format);
    assert.equal(s.transactions.length, f.rows);
    assert.equal(s.reconciliation.status, "PASS");
    if (f.opening !== undefined) assert.equal(s.reconciliation.openingBalance, f.opening);
    if (f.closing !== undefined) assert.equal(s.reconciliation.calculatedClosingBalance, f.closing);
    if (f.debits !== undefined) assert.deepEqual([s.reconciliation.totalDebits, s.reconciliation.totalCredits], [f.debits, f.credits]);
    if (f.upiRows !== undefined) {
      assert.equal(s.logs.filter((l) => l.level === "error").length, 0);
      const upi = s.transactions.filter((t) => /^UPI-/.test(t.particulars) && /^0{4}\d{12}$/.test(t.chequeNo ?? ""));
      assert.equal(upi.length, f.upiRows);
      assert.ok(upi.every((t) => t.particulars.includes(t.chequeNo.slice(4))), "wrapped narrations are joined without breaking the UPI reference");
    }
  });
}
