import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";

import { evaluate } from "../../src/invoice/service.js";
import { buildTallyWorkbookBuffer } from "../../src/invoice/tallyWorkbook.js";
import { gstinCheckChar } from "../../src/invoice/gstin.js";

const demoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "invoices", "demo");
const SAMPLES = ["invoice1", "invoice2", "invoice3", "invoice4"];
const hasSamples = SAMPLES.every((name) => existsSync(join(demoDir, `${name}.json`)));
const OPTIONS = { financialYear: "2026-27" };

const toWorkbook = async (evaluated, parties = []) => {
  const entries = evaluated.map((entry) => ({ ...entry, entryType: entry.party.entryType, partyName: entry.party.name }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildTallyWorkbookBuffer(entries, parties));
  return workbook;
};
const rows = (sheet) => {
  const out = [];
  // Dense row values; a formula reads as its cached result (ExcelJS omits a cached 0, Excel recalculates it).
  const value = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v?.formula !== undefined ? v.result ?? 0 : v ?? null);
  sheet.eachRow((row, n) => n > 1 && out.push(Array.from({ length: sheet.columnCount }, (_, i) => value(row.getCell(i + 1).value))));
  return out;
};

// Real client samples: inputs AND expected results live in the git-ignored demo folder, so no
// client names, GSTINs or amounts are in this file. expected.json was verified by hand against the
// spec values and the client's Invoice_Tally_Format_Sample.xlsx (GST Entries, Party Settings identical).
test("client samples: statuses, reasons and the Tally workbook match the verified expectations", { skip: !hasSamples && "needs fixtures/invoices/demo/*.json (git-ignored)" }, async () => {
  const read = (name) => JSON.parse(readFileSync(join(demoDir, name), "utf8"));
  const parties = read("parties.json");
  const expected = read("expected.json");
  const items = SAMPLES.map((name) => {
    const sample = read(`${name}.json`);
    return { invoice: sample.invoice, sourceFile: sample.file };
  });
  const evaluated = evaluate(items, { ...OPTIONS, parties });

  assert.deepEqual(
    evaluated.map((e) => ({ status: e.result.status, party: [e.party.name, e.party.entryType, e.party.source], reasons: e.result.reasons.map((r) => r.message) })),
    expected.invoices,
  );
  assert.deepEqual(evaluated.map((e) => e.result.status), ["OK", "OK", "INCOMPLETE", "OK"]);

  const workbook = await toWorkbook(evaluated, parties);
  assert.deepEqual(workbook.worksheets.map((s) => s.name), Object.keys(expected.sheets));
  for (const [name, expectedRows] of Object.entries(expected.sheets)) {
    const sheet = workbook.getWorksheet(name);
    const header = Array.from({ length: sheet.columnCount }, (_, i) => sheet.getRow(1).getCell(i + 1).value);
    assert.deepEqual([header, ...rows(sheet)], expectedRows, `sheet ${name}`);
  }
  const gst = workbook.getWorksheet("GST Entries");
  assert.equal(gst.getCell("E6").value.formula, "SUM(E2:E5)");
  assert.equal(gst.getCell("A2").numFmt, "dd/mm/yyyy");
  assert.equal(gst.getCell("A4").fill?.fgColor?.argb, "FFFFF2CC", "INCOMPLETE row is highlighted");
  assert.equal(workbook.getWorksheet("Stock Items").getCell("D4").fill?.fgColor?.argb, "FFFFF2CC", "low-confidence HSN highlighted");
});

test("Tally workbook: multi-rate GST rows, TCS bar bill, IMPORT placeholder, unknown party needs an entry type", async () => {
  const supplier = (prefix) => `${prefix}${gstinCheckChar(prefix)}`;
  const parties = [
    { name: "TEST BAR AND RESTAURANT", gstin: null, entryType: "TCS" },
    { name: "TEST IMPORTS", gstin: null, entryType: "IMPORT" },
    { name: "TEST TRADERS", gstin: null, entryType: "STOCK" },
  ];
  const items = [
    {
      invoice: {
        supplier: { name: "Test Traders", gstin: supplier("27AAAPT1111T1Z") },
        invoiceNo: "T-1",
        invoiceDate: "05/08/2026",
        lineItems: [
          { description: "Paint", qty: 2, rate: 1000, amount: 2000, gstRate: 18 },
          { description: "Brush", qty: 10, rate: 50, amount: 500, gstRate: 12 },
        ],
        totals: { taxableAmount: 2500, cgst: 210, sgst: 210, grandTotal: 2920 },
      },
    },
    {
      invoice: {
        supplier: { name: "Test Bar and Restaurant" },
        invoiceNo: "B-9",
        invoiceDate: "06/08/2026",
        lineItems: [{ description: "Beer", amount: 1000 }, { description: "Food", amount: 500, gstRate: 5 }],
        totals: { grandTotal: 1535, tcs: 10 },
      },
    },
    { invoice: { supplier: { name: "Test Imports" }, invoiceNo: "I-1", invoiceDate: "07/08/2026", totals: { grandTotal: 5000 } } },
  ];
  const evaluated = evaluate(items, { ...OPTIONS, parties });
  const workbook = await toWorkbook(evaluated, parties);

  const gst = rows(workbook.getWorksheet("GST Entries"));
  // Multi-rate: one row per rate; written per-line taxes absent, so tax cells blank (never computed).
  assert.deepEqual(gst.slice(0, 2).map((r) => [r[3], r[4], r[6]]), [["T-1", 2000, null], ["T-1", 500, null]]);
  assert.equal(gst[2][3], "B-9", "food part of the bar bill also goes to GST Entries");
  const tcs = rows(workbook.getWorksheet("TCS Entries"));
  assert.deepEqual(tcs[0].slice(1), ["TEST BAR AND RESTAURANT", "B-9", 1000, 10]);
  const imp = rows(workbook.getWorksheet("Import"));
  assert.deepEqual(imp[0].slice(1, 4), ["TEST IMPORTS", "I-1", 5000]);
  const review = rows(workbook.getWorksheet("Review"));
  assert.match(review[0][6], /Several GST rates/);
  assert.match(review[1][6], /also has GST items/);

  const unknown = evaluate([{ invoice: { supplier: { name: "Brand New Supplier" }, lineItems: [{ description: "Cement", hsnSac: "2523", qty: 1, rate: 1, amount: 1 }] } }], OPTIONS);
  assert.deepEqual([unknown[0].party.source, unknown[0].party.entryType], ["guess", "STOCK"]);
});
