import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { convertPdfToExcelBuffer } from "../src/parsers/converter.js";
import { readStatementWithAi } from "../src/parsers/bankAiFallback.js";

// Saved Gemini answers (fixtures/ai/*.json): no network, no key. A 2-page demo statement, opening 1,000.00.
const here = dirname(fileURLToPath(import.meta.url));
const saved = (name) => readFileSync(join(here, "fixtures", "ai", name), "utf8");
const usage = { model: "gemini-3.8-flash", requestedModel: "gemini-3.8-flash", inputTokens: 1000, outputTokens: 500 };

// A provider that answers with the saved texts in order and counts calls; running out of answers fails the test.
function fakeProvider(...answers) {
  const provider = {
    name: "fake",
    calls: 0,
    async complete() {
      assert.ok(provider.calls < answers.length, "unexpected extra Gemini call");
      return { text: answers[provider.calls++], usage };
    },
  };
  return provider;
}
const render = async () => [0, 1].map(() => ({ mediaType: "image/jpeg", data: Buffer.from("x") }));
const pdf = (name) => join(here, "fixtures", name);

// A readable text layer no parser knows -> UNSUPPORTED_LAYOUT (a thrown failure, never OCR).
async function unsupportedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("not a bank statement layout ".repeat(20).match(/.{1,60}/g).join("\n"), { x: 20, y: 700, size: 8, font, lineHeight: 10 });
  const path = join(mkdtempSync(join(tmpdir(), "ai-fallback-")), "unsupported.pdf");
  writeFileSync(path, await doc.save());
  return path;
}

test("AI read that reconciles is ok, AI-assisted, one call for the whole file", async () => {
  const provider = fakeProvider(saved("read-ok.json"));
  const statement = await readStatementWithAi(pdf("bob-502.pdf"), { provider, render });
  assert.equal(provider.calls, 1);
  assert.equal(statement.review.status, "ok");
  assert.equal(statement.transactions.length, 4);
  assert.deepEqual(statement.aiAssisted, { model: "fake", pages: 2, calls: 1, costInr: Math.round(((1000 * 0.75 + 500 * 3.75) / 1e6) * 88 * 100) / 100 });
  assert.equal(statement.reconciliation.openingBalance, 1000);
  assert.equal(statement.reconciliation.closingDifference, 0);
});

test("a misread page is re-read once; the fixed page then reconciles", async () => {
  const provider = fakeProvider(saved("read-misread.json"), saved("read-ok.json"));
  const statement = await readStatementWithAi(pdf("bob-502.pdf"), { provider, render });
  assert.equal(provider.calls, 2);
  assert.equal(statement.review.status, "ok");
  assert.equal(statement.transactions[2].balance, 1200);
});

test("still wrong after the one re-read: needs_review, numbers exactly as read, no third call", async () => {
  const provider = fakeProvider(saved("read-misread.json"), saved("read-misread.json"));
  const statement = await readStatementWithAi(pdf("bob-502.pdf"), { provider, render });
  assert.equal(provider.calls, 2);
  assert.equal(statement.review.status, "needs_review");
  assert.equal(statement.transactions[2].balance, 1020, "a number was changed to make a check pass");
  assert.ok(statement.review.reasons.some((reason) => /page\(s\) 1, 2/.test(reason)));
});

test("fallback gating: a failing file is read by AI and the Excel GRAND TOTAL is computed", async () => {
  const provider = fakeProvider(saved("read-ok.json"));
  const { buffer, statement } = await convertPdfToExcelBuffer(await unsupportedPdf(), { ai: { enabled: true, provider, render } });
  assert.equal(statement.aiAssisted.calls, 1);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = [];
  workbook.worksheets[0].eachRow((row) => rows.push(row.values.slice(1)));
  const total = rows.at(-1);
  assert.equal(total[2], "GRAND TOTAL");
  assert.deepEqual([total[6], total[7], total[8]], [300, 510.5, 1210.5]);
  assert.equal(rows[1][2], "Opening Balance");
});

test("fallback gating: off by default, and never used when the normal result is ok", async () => {
  const unsupported = await unsupportedPdf();
  const provider = fakeProvider(); // any call fails
  await assert.rejects(convertPdfToExcelBuffer(unsupported, { ai: { enabled: false, provider, render } }), { code: "UNSUPPORTED_LAYOUT" });
  const { statement } = await convertPdfToExcelBuffer(pdf("bob-502.pdf"), { ai: { enabled: true, provider, render } });
  assert.equal(statement.review.status, "ok");
  assert.equal(statement.aiAssisted, undefined);
});

test("failing file whose AI read does not reconcile comes back needs_review, never ok", async () => {
  const provider = fakeProvider(saved("read-misread.json"), saved("read-misread.json"));
  const { statement } = await convertPdfToExcelBuffer(await unsupportedPdf(), { ai: { enabled: true, provider, render } });
  assert.equal(statement.review.status, "needs_review"); // there was no normal result to keep
  assert.equal(statement.aiAssisted.pages, 2);
});
