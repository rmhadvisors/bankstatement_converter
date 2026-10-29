import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";

import { buildCardStatement, convertCreditCardToExcelBuffer } from "../../src/creditcard/ccConverter.js";
import { buildCreditCardWorkbookBuffer } from "../../src/creditcard/ccExcelWriter.js";
import { reconcile, removeDuplicateRows } from "../../src/creditcard/ccValidation.js";
import { parseHdfcCard } from "../../src/creditcard/issuers/hdfcCard.js";
import { parseIciciCard } from "../../src/creditcard/issuers/iciciCard.js";
import { parseSbiCard } from "../../src/creditcard/issuers/sbiCard.js";
import { parseAxisCard } from "../../src/creditcard/issuers/axisCard.js";
import { parseGenericCard } from "../../src/creditcard/issuers/genericCard.js";
import { convertPdfToStatement } from "../../src/parsers/converter.js";
import * as cards from "../fixtures/creditcard/synthetic-statements.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bankPdf = join(__dirname, "..", "fixtures", "bob-502.pdf");
const parsers = {
  hdfc: parseHdfcCard,
  icici: parseIciciCard,
  sbi: parseSbiCard,
  axis: parseAxisCard,
  kotakGeneric: parseGenericCard,
};

async function withPdf(lines, run) {
  const filePath = join(tmpdir(), `cc-test-${randomUUID()}.pdf`);
  await cards.writeStatementPdf(lines, filePath);
  try {
    return await run(filePath);
  } finally {
    await rm(filePath, { force: true });
  }
}

function allCellText(workbook) {
  const values = [];
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.text ?? "")))),
  );
  return values.join("\n");
}

test("credit card parsers: every synthetic issuer layout parses and reconciles", () => {
  for (const [name, parse] of Object.entries(parsers)) {
    const { lines, expected } = cards[name];
    const { summary, transactions } = parse(lines);
    const deduped = removeDuplicateRows(transactions);
    const result = reconcile(summary, deduped.transactions);

    assert.equal(deduped.transactions.length, expected.count, `${name} row count`);
    assert.equal(deduped.removed, expected.duplicatesRemoved ?? 0, `${name} duplicates`);
    assert.equal(result.totalDebits, expected.debits, `${name} debits`);
    assert.equal(result.totalCredits, expected.credits, `${name} credits`);
    assert.equal(result.status, "OK", `${name}: ${result.warnings.join(" ")}`);
    for (const [key, value] of Object.entries(expected.summary))
      assert.equal(summary[key], value, `${name} summary.${key}`);
  }
});

test("credit card parsers: add-on cards, foreign amounts, EMI, refs, continuations, ignored sections", () => {
  const hdfc = parseHdfcCard(cards.hdfc.lines).transactions;
  const find = (text) => hdfc.find((row) => row.description.includes(text));

  assert.equal(find("AMAZON PAY").description, "AMAZON PAY INDIA PRIVATE LIMITED BANGALORE");
  assert.deepEqual(
    [find("NETFLIX").foreignCurrency, find("NETFLIX").foreignAmount, find("NETFLIX").amount],
    ["USD", 15.49, 1300],
  );
  assert.deepEqual(
    [find("BIGBASKET").cardLast4, find("BIGBASKET").cardHolder],
    ["5678", "PRIYA SHARMA"],
  );
  assert.deepEqual([find("SWIGGY").cardLast4, find("SWIGGY").cardHolder], ["1234", "AKASH SHARMA"]);
  assert.ok(
    find("EMI INTEREST") && find("IGST ON EMI INTEREST") && find("FOREIGN CURRENCY MARKUP"),
  );
  assert.equal(find("REFUND").type, "credit");
  assert.equal(find("BONUS POINTS"), undefined, "reward points section is skipped");

  const icici = parseIciciCard(cards.icici.lines).transactions;
  const apple = icici.find((row) => row.description === "APPLE.COM/BILL");
  assert.deepEqual(
    [apple.refNo, apple.rewardPoints, apple.foreignCurrency, apple.foreignAmount],
    ["10234567895", 10, "USD", 35],
  );
  assert.equal(
    icici.find((row) => /CONVERT TO EMI/.test(row.description)),
    undefined,
    "EMI offer table is skipped",
  );

  const axis = parseAxisCard(cards.axis.lines).transactions;
  assert.equal(axis[0].amount, 1000, "Axis cashback column is not taken as the amount");
});

test("credit card workbook: styling, masking, formulas, By Card sheet", async () => {
  const { summary, transactions } = parseHdfcCard(cards.hdfc.lines);
  summary.issuer = "HDFC Bank";
  const statement = {
    summary,
    transactions,
    duplicatesRemoved: 0,
    reconciliation: reconcile(summary, transactions),
  };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCreditCardWorkbookBuffer(statement));
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["Transactions", "Summary", "By Card"],
  );

  const sheet = workbook.getWorksheet("Transactions");
  assert.equal(sheet.getCell("A1").value, "AKASH SHARMA");
  assert.equal(sheet.getCell("A2").value, "HDFC Bank Credit Card");
  assert.equal(sheet.getCell("A3").value, "Card: XXXX XXXX XXXX 1234");
  assert.match(sheet.getCell("A4").value, /Statement Period: 13\/02\/2024 to 12\/03\/2024/);
  assert.equal(sheet.getCell("A5").value, null, "no warning row when it reconciles");

  const header = sheet.getRow(6);
  assert.equal(header.getCell(1).value, "Date");
  assert.equal(header.getCell(1).fill.fgColor.argb, "FF2F5F5F");
  assert.equal(header.getCell(1).font.name, "Arial");
  assert.equal(header.getCell(1).font.color.argb, "FFFFFFFF");
  assert.equal(sheet.views[0].ySplit, 6);
  // Row 7: opening balance; transactions from row 8.
  assert.equal(sheet.getCell("B7").value, "Opening Balance (Previous Balance)");
  assert.equal(sheet.getCell("A8").numFmt, "dd/mm/yyyy");
  assert.equal(sheet.getCell("E8").numFmt, "#,##0.00");
  assert.equal(sheet.getCell("A8").fill.fgColor.argb, "FFF2F7F7");
  assert.equal(sheet.getCell("G6").value, "Balance (computed)");
  assert.deepEqual(sheet.getCell("G8").value, { formula: "G7+E8-F8", result: 10450 });

  const summarySheet = workbook.getWorksheet("Summary");
  const byLabel = Object.fromEntries(
    summarySheet
      .getSheetValues()
      .filter(Boolean)
      .map((row) => [row[1], row[2]]),
  );
  assert.equal(byLabel["Card Number"], "XXXX XXXX XXXX 1234");
  assert.match(byLabel["Total Debits (parsed)"].formula, /^SUM\(Transactions!E8:E18\)$/);
  assert.deepEqual(byLabel["Closing Balance (last row)"], {
    formula: "Transactions!G18",
    result: 8181.29,
  });
  assert.equal(byLabel["Reconciliation Check"].formula, "ROUND(B14+B19-B20-B9,2)");
  assert.equal(byLabel["Total Debits (parsed)"].result, 8681.29);
  assert.equal(byLabel["Reconciliation Status"], "OK");

  assert.doesNotMatch(allCellText(workbook), /4375/, "the card BIN never reaches the workbook");
});

test("credit card workbook: a mismatch shows a visible warning", async () => {
  const lines = cards.kotakGeneric.lines.filter((line) => !line.text.includes("MAKEMYTRIP"));
  const { summary, transactions: parsed } = parseGenericCard(lines);
  const { transactions } = removeDuplicateRows(parsed);
  const statement = { summary, transactions, reconciliation: reconcile(summary, transactions) };
  assert.equal(statement.reconciliation.status, "MISMATCH");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCreditCardWorkbookBuffer(statement));
  assert.match(
    workbook.getWorksheet("Transactions").getCell("A5").value,
    /^WARNING: .*off by ₹9,000\.00/,
  );
});

test("credit card converter: end to end from a text PDF", async () => {
  await withPdf(cards.hdfc.lines, async (filePath) => {
    const { buffer, statement } = await convertCreditCardToExcelBuffer(filePath);
    assert.equal(statement.summary.issuer, "HDFC Bank");
    assert.equal(statement.transactions.length, cards.hdfc.expected.count);
    assert.equal(statement.reconciliation.status, "OK");
    assert.ok(buffer.length > 0);
  });
});

test("credit card converter: a bank statement is refused, and the bank converter refuses a card statement", async () => {
  await assert.rejects(convertCreditCardToExcelBuffer(bankPdf), (error) => {
    assert.equal(error.code, "NOT_A_CREDIT_CARD_STATEMENT");
    assert.match(error.message, /bank account statement/);
    return true;
  });

  await withPdf(cards.hdfc.lines, (filePath) =>
    assert.rejects(
      convertPdfToStatement(filePath),
      (error) => error.code === "CREDIT_CARD_STATEMENT",
    ),
  );
});

test("ccConverter: ICICI yearly transaction export (no dues, Intl. amount column, alphanumeric refs)", () => {
  const lines = [
    "Customer Name Card Account No",
    "Mr Ravi Kumar 4315 XXXX XXXX 1234",
    "Statement Period",
    "01/04/2025 TO 31/03/2026",
    "TRANSACTION DETAILS",
    "Card Number : 4315 XXXX XXXX 1234",
    "International",
    "Date Ref. Number Transaction Details Currency Amount( in ` )",
    "amount",
    "23-MAY-25 74332745144514350034139 AMAZON INDIA CYBS SI MUMBAI IN 0.00 399.00",
    "12-JUN-25 DP115163112701ebYzOf BBPS Payment received 0.00 -697.00",
    "26-MAR-26 74332746086608559132567 MICROSOFT DISI MUMBAI IN 0.00 2,724.00",
    "Sincerely,",
    "Team ICICI Bank",
  ].map((text) => ({ text, pageNumber: 1 }));
  const { summary, transactions } = buildCardStatement(lines);
  assert.equal(summary.cardHolder, "Mr Ravi Kumar");
  assert.deepEqual(
    transactions.map((t) => [t.refNo, t.description, t.type, t.amount]),
    [
      ["74332745144514350034139", "AMAZON INDIA CYBS SI MUMBAI IN", "debit", 399],
      ["DP115163112701ebYzOf", "BBPS Payment received", "credit", 697],
      ["74332746086608559132567", "MICROSOFT DISI MUMBAI IN", "debit", 2724],
    ],
  );
});
