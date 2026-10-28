import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfPath = join(tmpdir(), `review-status-${randomUUID()}.pdf`);

// Synthetic Axis "Account Statement Report" (made-up account): row 3's printed balance is 1,000.00
// where 900.00 + 50.00 = 950.00, so the running balance breaks and the closing balance is off.
async function writeBrokenStatement(path) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 842]);
  const cell = (text, x, y) => page.drawText(text, { x, y, size: 7, font });
  cell("Statement of Axis Bank Account No : 000000000000001 for the period ( From : 01/08/2026 To : 31/08/2026 )", 15, 800);
  cell("Opening Balance: INR 1,000.00", 15, 785);
  const columns = [["S.NO", 15], ["Transaction", 42], ["Value Date", 93], ["Particulars", 144], ["Amount(INR)", 263], ["Debit/Credit", 314], ["Balance(INR)", 365], ["Cheque", 450], ["Branch Name(SOL)", 501]];
  for (const [text, x] of columns) cell(text, x, 760);
  cell("1", 15, 740);
  cell("OPENING BALANCE", 144, 740);
  cell("1,000.00", 400, 740);
  const rows = [
    ["2", "01/08/2026", "UPI/P2A/TEST PAYEE ONE", "100.00", "DR", "900.00", "000019"],
    ["3", "02/08/2026", "UPI/P2A/TEST PAYER TWO", "50.00", "CR", "1,000.00", ""],
  ];
  rows.forEach(([sno, date, particulars, amount, flag, balance, cheque], index) => {
    const y = 720 - index * 20;
    cell(sno, 15, y);
    cell(date, 42, y);
    cell(date, 93, y);
    cell(particulars, 144, y);
    cell(amount, 276, y);
    cell(flag, 350, y);
    cell(balance, 412, y);
    if (cheque) cell(cheque, 455, y);
  });
  cell("4 TRANSACTION TOTAL DR/CR 100.00/50.00", 15, 670);
  cell("Closing Balance: INR 1,000.00", 15, 650);
  cell("Unless the constituent notifies the bank immediately of any discrepancy found by him/her in this statement of Account, it will be taken that he/she has found the account correct.", 15, 600);
  await writeFile(path, await pdf.save());
}

let server;
let baseUrl;

before(async () => {
  await writeBrokenStatement(pdfPath);
  server = spawn(process.execPath, ["src/server.js"], { cwd: backendDir, env: { ...process.env, PORT: "0" } });
  baseUrl = await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    server.once("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
});

after(async () => {
  server?.kill();
  await rm(pdfPath, { force: true });
});

test("a statement that doesn't reconcile comes back as needs_review with reasons", async () => {
  const statement = await convertPdfToStatement(pdfPath);
  assert.equal(statement.transactions.length, 2);
  assert.equal(statement.review.status, "needs_review");
  assert.ok(statement.review.reasons.some((reason) => /Running balance breaks on 1 row/.test(reason)));
  assert.ok(statement.review.reasons.some((reason) => /closing balance/i.test(reason)));
});

test("API: needs_review status header, reasons, and a Review Required sheet in the workbook", async () => {
  const form = new FormData();
  form.append("statement", new Blob([await (await import("node:fs/promises")).readFile(pdfPath)], { type: "application/pdf" }), "broken.pdf");
  const submit = await fetch(`${baseUrl}/api/convert`, { method: "POST", body: form });
  assert.equal(submit.status, 202);
  const { jobId } = await submit.json();
  let response;
  do {
    await new Promise((resolve) => setTimeout(resolve, 200));
    response = await fetch(`${baseUrl}/api/convert/${jobId}`);
  } while (response.status === 202);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-conversion-status"), "needs_review");
  const reasons = JSON.parse(decodeURIComponent(response.headers.get("x-review-reasons")));
  assert.ok(reasons.some((reason) => /Running balance breaks/.test(reason)));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const review = workbook.getWorksheet("Review Required");
  assert.ok(review, "Review Required sheet present");
  assert.match(String(review.getCell("A1").value), /NEEDS REVIEW/);
  assert.equal(workbook.views[0].activeTab, workbook.worksheets.indexOf(review));

  // Format: Opening Balance row, real dates, cheque number as text with leading zeros, empty Tran ID.
  const sheet = workbook.getWorksheet("Statement of Account");
  assert.equal(sheet.getCell("C2").value, "Opening Balance");
  assert.equal(sheet.getCell("I2").value, 1000);
  assert.ok(sheet.getCell("A3").value instanceof Date);
  assert.equal(sheet.getCell("A3").numFmt, "dd-mm-yyyy");
  assert.equal(sheet.getCell("F3").value, "000019");
  assert.ok(!sheet.getCell("E3").value, "cheque number is not in Tran ID");
});
