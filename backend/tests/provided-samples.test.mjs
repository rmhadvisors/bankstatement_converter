import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import ExcelJS from "exceljs";
import XLSX from "xlsx";

import { convertPdfToExcelBuffer, convertPdfToStatement } from "../src/parsers/converter.js";

const samples = {
  idbi3445: {
    path: "C:/Users/HP/Downloads/IDBI BANK LIMITED 3445.pdf",
    expectedXlsx: "C:/Users/HP/Downloads/IDBI BANK LIMITED 3445 (2) (1).xlsx",
  },
  canara: {
    path: "C:/Users/HP/Downloads/CANARA BANK.pdf",
  },
  bankOfIndiaPipe: {
    path: "C:/Users/HP/Downloads/BANK OF INDIA.pdf",
  },
  pnb: {
    path: "C:/Users/HP/Downloads/PNB -PWS-123.pdf",
    password: "123",
  },
  boi: {
    path: "C:/Users/HP/Downloads/BOI AC 0077 passw faiy1004 (1).pdf",
    password: "faiy1004",
  },
  scb: {
    path: "C:/Users/HP/Downloads/Scb statement 1 april 25 to 31 March 26 Pass-23110360979 (1).pdf",
    password: "23110360979",
  },
  jana: {
    path: "C:/Users/HP/Downloads/JANA BANK.pdf",
  },
  vvsbInline: {
    path: "tmp/PARUL DEEPAK SHAH.pdf",
  },
};

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? roundMoney(number) : null;
}

function parseExpectedIdbiRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(sheet, { defval: null, raw: false })
    .map((row) => ({
      date: String(row["Value Date"] || row["Txn Date"] || "").slice(0, 10),
      description: String(row.Description || "").replace(/\s+/g, " ").trim(),
      chequeNo: row["Cheque No"] || null,
      withdrawal: parseMoney(row["Withdrawals (Dr)"]),
      deposit: parseMoney(row["Deposits (Cr)"]),
      balance: parseMoney(row["Balance (INR)"]),
    }));
}

test("provided IDBI sample preserves debit and credit columns", { skip: !existsSync(samples.idbi3445.path) }, async () => {
  const statement = await convertPdfToStatement(samples.idbi3445.path);

  assert.equal(statement.detectedFormat, "idbi");
  assert.equal(statement.transactions.length, 75);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);

  const neftCredit = statement.transactions[0];
  assert.ok(String(neftCredit.particulars).includes("NEFT-HDFCH00866858382"));
  assert.equal(neftCredit.withdrawal, null);
  assert.equal(neftCredit.deposit, 24377);
  assert.equal(roundMoney(neftCredit.balance), 135694.65);

  const smsDebit = statement.transactions.find((row) =>
    String(row.particulars).includes("SMS_CHARGE_FOR_OCT25_TO_"),
  );
  assert.equal(roundMoney(smsDebit.withdrawal), 5.32);
  assert.equal(smsDebit.deposit, null);
  assert.equal(roundMoney(smsDebit.balance), 21450.65);

  const interestCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("Int.:28-09-2025 To 27-12-2025"),
  );
  assert.equal(interestCredit.withdrawal, null);
  assert.equal(roundMoney(interestCredit.deposit), 490);
  assert.equal(roundMoney(interestCredit.balance), 87411.29);
});

test(
  "provided IDBI PDF conversion matches supplied Excel debit credit balance values",
  { skip: !existsSync(samples.idbi3445.path) || !existsSync(samples.idbi3445.expectedXlsx) },
  async () => {
    const statement = await convertPdfToStatement(samples.idbi3445.path);
    const expectedRows = parseExpectedIdbiRows(samples.idbi3445.expectedXlsx);

    assert.equal(statement.transactions.length, expectedRows.length);

    for (let index = 0; index < expectedRows.length; index += 1) {
      const actual = statement.transactions[index];
      const expected = expectedRows[index];

      assert.equal((actual.valueDate || actual.date).toISOString().slice(0, 10).split("-").reverse().join("/"), expected.date);
      assert.equal(String(actual.particulars || "").replace(/\s+/g, " ").trim(), expected.description);
      assert.equal(actual.chequeNo || null, expected.chequeNo);
      assert.equal(actual.withdrawal === null ? null : roundMoney(actual.withdrawal), expected.withdrawal);
      assert.equal(actual.deposit === null ? null : roundMoney(actual.deposit), expected.deposit);
      assert.equal(roundMoney(actual.balance), expected.balance);
    }
  },
);

test(
  "provided IDBI Excel output uses supplied BANK STATEMENT layout and values",
  { skip: !existsSync(samples.idbi3445.path) || !existsSync(samples.idbi3445.expectedXlsx) },
  async () => {
    const { buffer } = await convertPdfToExcelBuffer(samples.idbi3445.path);
    const actualWorkbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const expectedWorkbook = XLSX.readFile(samples.idbi3445.expectedXlsx, { cellDates: false });

    assert.deepEqual(actualWorkbook.SheetNames, ["BANK STATEMENT"]);

    const actualRows = XLSX.utils.sheet_to_json(actualWorkbook.Sheets["BANK STATEMENT"], {
      defval: null,
      raw: false,
    });
    const expectedRows = XLSX.utils.sheet_to_json(expectedWorkbook.Sheets["BANK STATEMENT"], {
      defval: null,
      raw: false,
    });

    const headers = [
      "Txn Date",
      "Value Date",
      "Description",
      "Cheque No",
      "Withdrawals (Dr)",
      "Deposits (Cr)",
      "Balance (INR)",
    ];

    assert.deepEqual(Object.keys(actualRows[0]), headers);
    assert.equal(actualRows.length, expectedRows.length);

    for (let index = 0; index < expectedRows.length; index += 1) {
      const actual = actualRows[index];
      const expected = expectedRows[index];

      assert.equal(actual["Value Date"], expected["Value Date"]);
      assert.equal(
        String(actual.Description || "").replace(/\s+/g, " ").trim(),
        String(expected.Description || "").replace(/\s+/g, " ").trim(),
      );
      assert.equal(actual["Cheque No"] || null, expected["Cheque No"] || null);
      assert.equal(parseMoney(actual["Withdrawals (Dr)"]), parseMoney(expected["Withdrawals (Dr)"]));
      assert.equal(parseMoney(actual["Deposits (Cr)"]), parseMoney(expected["Deposits (Cr)"]));
      assert.equal(parseMoney(actual["Balance (INR)"]), parseMoney(expected["Balance (INR)"]));
    }
  },
);

test("provided Canara sample loads with UPI DR/CR mapped from statement columns", { skip: !existsSync(samples.canara.path) }, async () => {
  const statement = await convertPdfToStatement(samples.canara.path);

  assert.equal(statement.detectedFormat, "canara");
  assert.equal(statement.transactions.length, 46);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);

  const upiDebit = statement.transactions.find((row) =>
    String(row.particulars).includes("UPI/DR/548148690849"),
  );
  assert.equal(roundMoney(upiDebit.withdrawal), 10000);
  assert.equal(upiDebit.deposit, null);
  assert.equal(roundMoney(upiDebit.balance), 138008.49);

  const upiCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("UPI/CR/109973562748"),
  );
  assert.equal(upiCredit.withdrawal, null);
  assert.equal(roundMoney(upiCredit.deposit), 20000);
  assert.equal(roundMoney(upiCredit.balance), 110670.37);
});

test("provided PNB sample maps Type CR to credit and Type DR to debit", { skip: !existsSync(samples.pnb.path) }, async () => {
  const statement = await convertPdfToStatement(samples.pnb.path, { password: samples.pnb.password });

  assert.equal(statement.detectedFormat, "pnb");
  assert.equal(statement.transactions.length, 416);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);

  const upiDebit = statement.transactions.find((row) =>
    String(row.particulars).includes("UPI/DR/119482308510"),
  );
  assert.equal(roundMoney(upiDebit.withdrawal), 80);
  assert.equal(upiDebit.deposit, null);
  assert.equal(roundMoney(upiDebit.balance), 3670.97);

  const interestCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("Int.Pd:01-12-2025"),
  );
  assert.equal(interestCredit.withdrawal, null);
  assert.equal(roundMoney(interestCredit.deposit), 219);
  assert.equal(roundMoney(interestCredit.balance), 8794.47);

  const impsCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("IMPS-IN/605827950087"),
  );
  assert.equal(impsCredit.withdrawal, null);
  assert.equal(roundMoney(impsCredit.deposit), 15000);
  assert.equal(roundMoney(impsCredit.balance), 29465.47);

  const upiCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("UPI/CR/640751192401"),
  );
  assert.equal(upiCredit.withdrawal, null);
  assert.equal(roundMoney(upiCredit.deposit), 60);
  assert.equal(roundMoney(upiCredit.balance), 44482.16);
});

test("provided Bank of India pipe-table sample loads and strips balance suffixes", { skip: !existsSync(samples.bankOfIndiaPipe.path) }, async () => {
  const statement = await convertPdfToStatement(samples.bankOfIndiaPipe.path);

  assert.equal(statement.detectedFormat, "bank-of-india");
  assert.equal(statement.transactions.length, 867);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);

  const upiDebit = statement.transactions.find((row) =>
    String(row.particulars).includes("UPI/102462574798/DR/ORCHID"),
  );
  assert.equal(roundMoney(upiDebit.withdrawal), 450);
  assert.equal(upiDebit.deposit, null);
  assert.equal(roundMoney(upiDebit.balance), 127819.32);

  const neftCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("NEFT/AXNGG09306261744"),
  );
  assert.equal(neftCredit.withdrawal, null);
  assert.equal(roundMoney(neftCredit.deposit), 2000);
  assert.equal(roundMoney(neftCredit.balance), 129362.32);
});

test("provided Bank of India sample reconciles without missing debit/credit values", { skip: !existsSync(samples.boi.path) }, async () => {
  const statement = await convertPdfToStatement(samples.boi.path, { password: samples.boi.password });

  assert.equal(statement.detectedFormat, "bank-of-india");
  assert.equal(statement.pageCount, 22);
  assert.equal(statement.transactions.length, 471);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);
  assert.equal(roundMoney(statement.reconciliation.totalDebits), 1690632.18);
  assert.equal(roundMoney(statement.reconciliation.totalCredits), 1605426.28);
  assert.equal(roundMoney(statement.reconciliation.calculatedClosingBalance), 145934.08);
  assert.equal(statement.transactions[0].withdrawal, 2900);
  assert.equal(statement.transactions[0].deposit, null);
  assert.equal(statement.transactions.at(-1).deposit, 115977);
  assert.equal(statement.transactions.at(-1).withdrawal, null);
});

test("provided Standard Chartered sample loads and reconciles negative-balance rows", { skip: !existsSync(samples.scb.path) }, async () => {
  const statement = await convertPdfToStatement(samples.scb.path, { password: samples.scb.password });

  assert.equal(statement.detectedFormat, "standard-chartered");
  assert.equal(statement.pageCount, 237);
  assert.equal(statement.transactions.length, 1886);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);
  assert.equal(roundMoney(statement.reconciliation.totalDebits), 4555483.15);
  assert.equal(roundMoney(statement.reconciliation.totalCredits), 4497017.63);
  assert.equal(roundMoney(statement.reconciliation.calculatedClosingBalance), 60749.84);
  assert.ok(statement.transactions.some((row) => row.balance < 0), "negative balance rows should be preserved");
});

test("provided Jana Bank sample loads rotated table rows and reconciles", { skip: !existsSync(samples.jana.path) }, async () => {
  const statement = await convertPdfToStatement(samples.jana.path);

  assert.equal(statement.detectedFormat, "jana");
  assert.equal(statement.pageCount, 103);
  assert.equal(statement.transactions.length, 1729);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);
  assert.equal(roundMoney(statement.reconciliation.totalDebits), 1050356.75);
  assert.equal(roundMoney(statement.reconciliation.totalCredits), 1051340.2);
  assert.equal(roundMoney(statement.reconciliation.openingBalance), 603.47);
  assert.equal(roundMoney(statement.reconciliation.calculatedClosingBalance), 1586.92);

  const firstRow = statement.transactions[0];
  assert.equal(firstRow.date.toISOString().slice(0, 10), "2026-03-31");
  assert.ok(String(firstRow.particulars).includes("UPI/DR/399911343270"));
  assert.equal(roundMoney(firstRow.withdrawal), 5000);
  assert.equal(firstRow.deposit, null);
  assert.equal(roundMoney(firstRow.balance), 1586.92);

  const creditRow = statement.transactions.find((row) =>
    String(row.particulars).includes("UPI/CR/718900332918"),
  );
  assert.equal(creditRow.withdrawal, null);
  assert.equal(roundMoney(creditRow.deposit), 5000);
  assert.equal(roundMoney(creditRow.balance), 10086.92);
});

test("provided VVSB inline statement loads rows and reconciles printed summary", { skip: !existsSync(samples.vvsbInline.path) }, async () => {
  const statement = await convertPdfToStatement(samples.vvsbInline.path);

  assert.equal(statement.detectedFormat, "vvsb");
  assert.equal(statement.pageCount, 5);
  assert.equal(statement.transactions.length, 135);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(statement.reconciliation.suspiciousTransactions.length, 0);
  assert.equal(roundMoney(statement.totals.withdrawal), 467383.72);
  assert.equal(roundMoney(statement.totals.deposit), 422564);
  assert.equal(roundMoney(statement.totals.closingBalance), 1554.62);

  const firstRow = statement.transactions[0];
  assert.equal(firstRow.date.toISOString().slice(0, 10), "2025-04-10");
  assert.ok(String(firstRow.particulars).includes("IMPS/OUT/0/5100128870"));
  assert.ok(String(firstRow.particulars).includes("89/maintenance"));
  assert.equal(roundMoney(firstRow.withdrawal), 15970);
  assert.equal(firstRow.deposit, null);
  assert.equal(roundMoney(firstRow.balance), 30404.34);

  const chequeCredit = statement.transactions.find((row) =>
    String(row.particulars).includes("CTS OW TRUSHNA DOCUMENTS"),
  );
  assert.equal(chequeCredit.withdrawal, null);
  assert.equal(roundMoney(chequeCredit.deposit), 37500);
  assert.equal(roundMoney(chequeCredit.balance), 44824.92);

  const lastRow = statement.transactions.at(-1);
  assert.equal(lastRow.date.toISOString().slice(0, 10), "2026-03-31");
  assert.equal(String(lastRow.particulars), "INT Cr.Oct-2025 to Mar- 2026");
  assert.equal(lastRow.withdrawal, null);
  assert.equal(roundMoney(lastRow.deposit), 499);
  assert.equal(roundMoney(lastRow.balance), 1554.62);
});

test("Excel output includes transactions, reconciliation, and logs sheets", { skip: !existsSync(samples.boi.path) }, async () => {
  const { buffer } = await convertPdfToExcelBuffer(samples.boi.path, { password: samples.boi.password });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Extracted Transactions",
    "Validation & Reconciliation",
    "Error Logs",
  ]);
});

test("provided FY 2025-2026 scanned Axis statement uses trained rows and reports the missing August gap", { skip: !existsSync("tmp/FY-2025-2026.pdf") || !existsSync("FY-2025-2026-Converted.xlsx") }, async () => {
  const statement = await convertPdfToStatement("tmp/FY-2025-2026.pdf");

  assert.equal(statement.transactions.length, 99);
  assert.equal(statement.transactions[0].date.toISOString().slice(0, 10), "2025-04-27");
  assert.ok(String(statement.transactions[0].particulars).includes("ACH-DR-HDFC BANK LTD"));
  assert.equal(roundMoney(statement.transactions[0].withdrawal), 24247);
  assert.equal(statement.transactions[0].deposit, null);
  assert.equal(roundMoney(statement.transactions.at(-1).balance), 72267.49);
  assert.equal(statement.reconciliation.status, "FAIL");
  assert.equal(roundMoney(statement.reconciliation.closingDifference), 147);
  assert.ok(statement.logs.some((log) => /Used trained transaction rows/.test(log.message || "")));
});

test("provided SBI password statement extracts embedded rows and reconciles", { skip: !existsSync("tmp/AccountStatement_29062026_121659 PWD-14681140151.pdf") }, async () => {
  const statement = await convertPdfToStatement("tmp/AccountStatement_29062026_121659 PWD-14681140151.pdf", { password: "14681140151" });

  assert.equal(statement.detectedFormat, "sbi");
  assert.equal(statement.transactions.length, 147);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(roundMoney(statement.reconciliation.closingDifference), 0);
  assert.equal(statement.transactions[0].date.toISOString().slice(0, 10), "2025-04-02");
  assert.ok(String(statement.transactions[0].particulars).includes("NEFT*HDFC0000240"));
  assert.equal(statement.transactions[0].withdrawal, null);
  assert.equal(roundMoney(statement.transactions[0].deposit), 2187);
  assert.equal(roundMoney(statement.transactions.at(-1).balance), 348835.42);
});

test("provided Ambika Axis statement extracts embedded rows and reconciles", { skip: !existsSync("tmp/AMBI909233582-5642-25-26.pdf") }, async () => {
  const statement = await convertPdfToStatement("tmp/AMBI909233582-5642-25-26.pdf");

  assert.equal(statement.detectedFormat, "axis");
  assert.equal(statement.transactions.length, 501);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(roundMoney(statement.reconciliation.closingDifference), 0);
  assert.equal(statement.transactions[0].date.toISOString().slice(0, 10), "2025-04-01");
  assert.ok(String(statement.transactions[0].particulars).includes("Niyogin"));
  assert.equal(roundMoney(statement.transactions[0].withdrawal), 1252);
  assert.equal(statement.transactions[0].deposit, null);
  assert.equal(roundMoney(statement.transactions.at(-1).balance), 324.58);
});

test("provided Sona Axis password statement extracts embedded rows and reconciles", { skip: !existsSync("tmp/SONA898672010-7689-25-26.pdf") }, async () => {
  const statement = await convertPdfToStatement("tmp/SONA898672010-7689-25-26.pdf", { password: "SONA898672010" });

  assert.equal(statement.detectedFormat, "axis");
  assert.equal(statement.transactions.length, 207);
  assert.equal(statement.reconciliation.status, "PASS");
  assert.equal(roundMoney(statement.reconciliation.closingDifference), 0);
  assert.equal(statement.transactions[0].date.toISOString().slice(0, 10), "2025-04-01");
  assert.ok(String(statement.transactions[0].particulars).includes("KHALID KHALIL"));
  assert.equal(roundMoney(statement.transactions[0].withdrawal), 500);
  assert.equal(statement.transactions[0].deposit, null);
  assert.equal(roundMoney(statement.transactions.at(-1).balance), 50);
});
