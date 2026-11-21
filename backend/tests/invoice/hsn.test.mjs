import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import { createCanvas } from "@napi-rs/canvas";
import { applyReadingRules, hsnFromRawLine, validHsn } from "../../src/invoice/rules.js";
import { learnFrom, loadDictionary } from "../../src/invoice/hsnDictionary.js";
import { extractInvoiceDetailed } from "../../src/invoice/extract.js";
import { validateInvoice } from "../../src/invoice/validate.js";
import { buildInvoiceSheetBuffer } from "../../src/invoice/tallyWorkbook.js";

// Saved readings: what Gemini returned for DEC SALES lines (HSN empty although written), no network.
const line = (rawLine, qty, amount, extra = {}) => ({ description: rawLine.replace(/[\d/.,-]+/g, " ").trim(), rawLine, qty, rate: null, amount, hsnSac: null, ...extra });
const run = (lines, invoiceNo = "1051", options) => applyReadingRules({ invoiceNo, lineItems: lines, totals: {} }, options).invoice.lineItems;

test("a) HSN and rate from the line's own text: 1051, 1054, 1056", () => {
  const [a, b] = run([line("68/SF flim 3920 55/- 3,740/-", 68, 3740), line("42/SF Blinds 6303 330/- 13,860/-", 42, 13860)]);
  assert.deepEqual([a.hsnSac, a.rate, b.hsnSac, b.rate], ["3920", 55, "6303", 330]);
  const [c] = run([line("720 sq.ft PVC flooring 3918 24 17280/-", 720, 17280)], "1054/40-61/725");
  assert.deepEqual([c.hsnSac, c.rate], ["3918", 24]);
  const [d] = run([line("323 sq.ft PVC Flooring 3918 38.50 12,436.50/-", 323, 12436.5)], "1056/728");
  assert.deepEqual([d.hsnSac, d.rate], ["3918", 38.5]);
  assert.equal(c.hsnNote, undefined); // read directly: not yellow
});

test("a) rejects a 4-digit number that is an amount, the qty, a year or the invoice number; ambiguity gives nothing", () => {
  assert.equal(hsnFromRawLine(line("1 Blinds 5617", 1, 5617), {}), null);
  assert.equal(hsnFromRawLine(line("1 Fevicol 1200 3600", 1, 3600), {}), null); // 1200 x 3 would not fit; only candidate is no HSN
  assert.equal(hsnFromRawLine(line("1200 sqft Film 3920 45 54000", 1200, 54000), {}).hsn, "3920"); // 1200 is the qty
  assert.equal(hsnFromRawLine(line("100 PVC 2025 30 3000", 100, 3000), {}), null); // a year
  assert.equal(hsnFromRawLine(line("100 PVC 1051 30 3000", 100, 3000), { invoiceNo: "1051" }), null); // the invoice number
});

test("1060: no HSN written -> stays empty, no note; a written HSN is never changed", () => {
  const [m] = run([line("39/sq Non woven fell 35/- 1365", 39, 1365)], "1060");
  assert.equal(m.hsnSac, null);
  assert.equal(m.hsnNote, undefined);
  const [w] = run([line("68/SF flim 3918 55/- 3,740/-", 68, 3740, { hsnSac: "3920" })]);
  assert.equal(w.hsnSac, "3920");
});

test("b) same item on the invoice and c) dictionary are copied but flagged", () => {
  const [one, two] = run([line("PVC flooring 3918 26/- 11,180/-", 430, 11180, { hsnSac: "3918" }), { description: "pvc flooring", qty: 10, rate: 20, amount: 200, hsnSac: null }]);
  assert.equal(two.hsnSac, "3918");
  assert.match(two.hsnNote, /taken from line 1, not written on the bill/);
  const [dict] = run([{ description: "Fevicol", qty: 2, rate: 275, amount: 550, hsnSac: null }], "9", { dictionary: new Map([["fevicol", "6503"]]) });
  assert.equal(dict.hsnSac, "6503");
  assert.match(dict.hsnNote, /item dictionary/);
  assert.equal(one.hsnNote, undefined);
});

test("validation: HSN must be 4, 6 or 8 digits, chapter 01-97", () => {
  for (const ok of ["3918", "391820", "39182010", "999999"]) assert.equal(validHsn(ok), true, ok);
  for (const bad of ["391", "39182", "0001", "9803", "39A8", "", null]) assert.equal(validHsn(bad), false, String(bad));
  const reasons = validateInvoice({ lineItems: [{ description: "x", hsnSac: "391", qty: 1, rate: 1, amount: 1 }], totals: {} }).reasons;
  assert.ok(reasons.some((r) => r.field === "lineItems[0].hsnSac"));
});

test("dictionary: learned only from written HSNs, needs 2 different lines and no conflict, manual entries win", () => {
  const dir = mkdtempSync(join(tmpdir(), "hsn-dict-"));
  Object.assign(process.env, { INVOICE_HSN_DICTIONARY: "on", INVOICE_DATA_DIR: dir, INVOICE_CLIENT: "t" });
  try {
    const bill = (no, hsn) => ({ invoiceNo: no, invoiceDate: "01/12/2025", lineItems: [{ description: "Film 55 sqft", hsnSac: hsn }] });
    learnFrom(bill("1", "3920"));
    learnFrom(bill("1", "3920")); // same bill again: not a second occurrence
    assert.equal(loadDictionary().get("film"), undefined);
    learnFrom(bill("2", "3920"));
    assert.equal(loadDictionary().get("film"), "3920");
    learnFrom(bill("3", "3918")); // conflict -> unused
    assert.equal(loadDictionary().get("film"), undefined);
    writeFileSync(join(dir, "hsn-t.json"), JSON.stringify({ manual: { Film: "3920" } }));
    assert.equal(loadDictionary().get("film"), "3920");
  } finally {
    process.env.INVOICE_HSN_DICTIONARY = "off";
    rmSync(dir, { recursive: true, force: true });
  }
});

const photo = join(tmpdir(), `hsn-${randomUUID()}.png`);
before(async () => writeFileSync(photo, await createCanvas(300, 300).encode("png")));
after(() => rmSync(photo, { force: true }));

test("d) one extra targeted call when a line still has no HSN; its answer goes through the same check", async () => {
  const first = { invoiceNo: "7", lineItems: [{ description: "Film", hsnSac: "3920", qty: 10, rate: 5, amount: 50 }, { description: "Blinds", hsnSac: null, qty: 42, rate: null, amount: 13860 }], totals: {} };
  const answers = [JSON.stringify(first), JSON.stringify({ lines: [{ line: 2, rawLine: "42/SF Blinds 6303 330/- 13,860/-", hsn: "6303", rate: 330, amount: 13860 }] })];
  const provider = { name: "mock:x", calls: 0, async complete() { return { text: answers[provider.calls++], usage: { model: "m", inputTokens: 1, outputTokens: 1 } }; } };
  const { invoice, meta } = await extractInvoiceDetailed({ name: "b.png", path: photo }, { provider });
  assert.equal(provider.calls, 2);
  assert.equal(meta.hsnReread, 1);
  assert.deepEqual([invoice.lineItems[1].hsnSac, invoice.lineItems[1].rate], ["6303", 330]);
  assert.match(invoice.lineItems[1].hsnNote, /reading line 2 again/);
});

test("export: an HSN not written on the bill is a yellow cell with the reason as a note; format unchanged", async () => {
  const invoice = { invoiceNo: "1", invoiceDate: "02/12/2025", lineItems: [{ description: "Film", hsnSac: "3920", hsnNote: "HSN 3920 taken from line 1, not written on the bill", qty: 1, rate: 100, amount: 100, gstRate: 18 }, { description: "Film", hsnSac: "3920", qty: 1, rate: 100, amount: 100, gstRate: 18 }], totals: { cgst: 18, sgst: 18 } };
  const buffer = await buildInvoiceSheetBuffer([{ invoice, result: { status: "OK", computed: { intraState: true, taxable: 200 } }, partyName: "P" }]);
  const sheet = (await new ExcelJS.Workbook().xlsx.load(buffer)).getWorksheet("GST Entries");
  assert.equal(sheet.getRow(1).getCell(5).value, "HSN CODE");
  assert.match(String(sheet.getRow(2).getCell(5).note?.texts?.[0]?.text ?? sheet.getRow(2).getCell(5).note), /not written on the bill/);
  assert.equal(sheet.getRow(2).getCell(5).fill.fgColor.argb, "FFFFFF00");
  assert.equal(sheet.getRow(3).getCell(5).fill?.fgColor?.argb, "FFFFFFFF");
});
