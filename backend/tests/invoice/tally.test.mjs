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
  assert.deepEqual(workbook.worksheets.map((s) => s.name).filter((n) => n !== "Lines"), Object.keys(expected.sheets));
  for (const [name, expectedRows] of Object.entries(expected.sheets)) {
    const sheet = workbook.getWorksheet(name);
    const header = Array.from({ length: sheet.columnCount }, (_, i) => sheet.getRow(1).getCell(i + 1).value);
    assert.deepEqual([header, ...rows(sheet)], expectedRows, `sheet ${name}`);
  }
  const gst = workbook.getWorksheet("GST Entries");
  assert.equal(gst.getCell("E7").value.formula, "SUM(E2:E6)", "TOTAL sums every row, including the split ones");
  assert.equal(gst.getCell("A2").numFmt, "dd/mm/yyyy");
  assert.equal(gst.getCell("A4").fill?.fgColor?.argb, "FFFFF2CC", "INCOMPLETE row is highlighted");
  assert.equal(gst.getCell("A5").fill?.fgColor?.argb, "FFFFF2CC", "its no-rate row is highlighted");
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
  // Multi-rate: one row per rate, tax = taxable x rate from the lines (18% and 12%).
  assert.deepEqual(gst.slice(0, 2).map((r) => [r[3], r[4], r[6], r[7]]), [["T-1", 2000, 180, 180], ["T-1", 500, 30, 30]]);
  assert.equal(gst[2][3], "B-9", "food part of the bar bill also goes to GST Entries");
  const tcs = rows(workbook.getWorksheet("TCS Entries"));
  assert.deepEqual(tcs[0].slice(1), ["TEST BAR AND RESTAURANT", "B-9", 1000, 10]);
  const imp = rows(workbook.getWorksheet("Import"));
  assert.deepEqual(imp[0].slice(1, 4), ["TEST IMPORTS", "I-1", 5000]);
  const review = rows(workbook.getWorksheet("Review"));
  assert.match(review[0][6], /^All amounts check/, "split adds up to the printed totals: no mismatch note");
  assert.match(review[1][6], /also has GST items/);

  const unknown = evaluate([{ invoice: { supplier: { name: "Brand New Supplier" }, lineItems: [{ description: "Cement", hsnSac: "2523", qty: 1, rate: 1, amount: 1 }] } }], OPTIONS);
  assert.deepEqual([unknown[0].party.source, unknown[0].party.entryType], ["guess", "STOCK"]);
});

// Regression (export rules): the saved Sarvam reading of the client's P.T.O. invoice, run through the
// same rules, checks and export as a live reading. No API call; skips without the git-ignored file.
const sarvamReadings = ["invoice1", "invoice2", "invoice3", "invoice4"].map((name) => join(demoDir, `${name}.sarvam.live.json`));
test("saved Sarvam readings: one row per invoice, INCOMPLETE stays blank, payment notes, plain review notes, sheets", { skip: !sarvamReadings.every(existsSync) && "needs the saved Sarvam readings (git-ignored)" }, async () => {
  const { applyReadingRules } = await import("../../src/invoice/rules.js");
  const { validateInvoiceJson } = await import("../../src/invoice/schema.js");
  const parties = JSON.parse(readFileSync(join(demoDir, "parties.json"), "utf8"));
  const items = sarvamReadings.map((path) => {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    const { invoice, derived } = applyReadingRules(validateInvoiceJson(saved.invoice).invoice);
    return { invoice: { ...invoice, derived }, sourceFile: saved.file };
  });
  const evaluated = evaluate(items, { ...OPTIONS, parties });
  const pto = evaluated.find((e) => e.result.status === "INCOMPLETE");
  assert.ok(pto, "the P.T.O. invoice is INCOMPLETE");

  // 4. Plain, ordered review notes; no field paths, no duplicates, one "please check" per field.
  const notes = pto.result.reasons.map((r) => r.message);
  assert.equal(notes[0], "Totals, CGST, SGST and grand total are blank and the page says P.T.O. Upload the back page or enter the totals.");
  assert.match(notes[1], /^The 4 lines add up to Rs 2,15,379\. At 18% GST that would be CGST 19,384\.11 and SGST 19,384\.11 \(not on the invoice\)\.$/);
  assert.ok(notes.includes("Line 1: written 1,54,624, but 966.45 sqft x 160 = 1,54,632."));
  assert.ok(notes.some((n) => /^Line 4 \(.+, 8,950\): no GST rate written\.$/.test(n)));
  assert.ok(notes.includes("Please check (hard to read): line 3 area 172.25 sqft."));
  assert.equal(notes.length, 5, notes.join(" | "));
  for (const e of evaluated) {
    const messages = e.result.reasons.map((r) => r.message);
    assert.equal(new Set(messages).size, messages.length, "no duplicate notes");
    assert.ok(messages.every((m) => !/\w+\[\d+\]|handwrittenNotes|lineItems|totals\.\w/.test(m)), "no field paths");
  }

  // 3. Payment notes: only payment text, never the invoice's transcription.
  assert.deepEqual(pto.invoice.handwrittenNotes, []);
  const workbook = await toWorkbook(evaluated, parties);

  // 5. No empty sheets, no Party Settings by default.
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["GST Entries", "Lines", "Stock Items", "Review"]);

  // 1 + 2. One GST row per invoice, except the INCOMPLETE one: rate-wise rows from its lines, yellow.
  const gst = workbook.getWorksheet("GST Entries");
  const gstAll = rows(gst);
  const gstRows = gstAll.filter((r) => r[3] && r[3] !== "TOTAL");
  assert.equal(gstRows.length, 5);
  const ptoRows = gstRows.filter((r) => r[3] === pto.invoice.invoiceNo);
  assert.deepEqual(ptoRows.map((r) => r.slice(4, 8)), [[206429, 0, 18578.61, 18578.61], [8950, null, null, null]]);
  for (const r of ptoRows) assert.equal(gst.getRow(gstAll.indexOf(r) + 2).getCell(1).fill?.fgColor?.argb, "FFFFF2CC");

  // The other three readings export the same GST figures as the hand-typed values.
  const expected = JSON.parse(readFileSync(join(demoDir, "expected.json"), "utf8")).sheets["GST Entries"];
  assert.deepEqual(gstRows.map((r) => r.slice(0, 8)), expected.slice(1, 6).map((r) => r.slice(0, 8)));

  const review = rows(workbook.getWorksheet("Review"));
  const ptoReview = review.find((r) => r[0] === pto.invoice.invoiceNo);
  assert.equal(ptoReview[5] || null, null, "no payment note on the P.T.O. invoice");
  assert.ok(review.every((r) => !r[5] || /payment|cheque|neft|recd|received|recieved/i.test(r[5])), "payment notes are about payment");

  // "Use computed totals": the unrated line takes the single rate of the others -> one row.
  pto.invoice.useComputedTotals = true;
  const chosen = await toWorkbook(evaluate(items.map((item) => (item.invoice.invoiceNo === pto.invoice.invoiceNo ? { ...item, invoice: { ...item.invoice, useComputedTotals: true } } : item)), { ...OPTIONS, parties }), parties);
  const chosenRows = rows(chosen.getWorksheet("GST Entries")).filter((r) => r[3] === pto.invoice.invoiceNo);
  assert.deepEqual(chosenRows.map((r) => r.slice(4, 8)), [[215379, 0, 19384.11, 19384.11]]);

  // Party Settings only when asked for.
  const withSettings = new ExcelJS.Workbook();
  await withSettings.xlsx.load(await buildTallyWorkbookBuffer(evaluated.map((e) => ({ ...e, entryType: e.party.entryType, partyName: e.party.name })), parties, { includePartySettings: true }));
  assert.ok(withSettings.getWorksheet("Party Settings"));
});

// GST Entries: one row per line GST rate, built from the lines.
const gstSplit = async (invoice, partyName = "TEST TRADERS") => {
  const parties = [{ name: partyName, gstin: null, entryType: "STOCK" }];
  const evaluated = evaluate([{ invoice: { supplier: { name: partyName }, invoiceNo: "S-1", invoiceDate: "05/08/2026", ...invoice } }], { ...OPTIONS, parties });
  const workbook = await toWorkbook(evaluated, parties);
  const sheet = workbook.getWorksheet("GST Entries");
  const all = rows(sheet).filter((r) => r[3] === "S-1");
  return {
    sheet,
    gst: all.map((r) => r.slice(4, 8)),
    yellow: all.map((_, i) => sheet.getRow(i + 2).getCell(1).fill?.fgColor?.argb === "FFFFF2CC"),
    stock: all.map((r) => r[8]),
    review: rows(workbook.getWorksheet("Review"))[0][6],
    status: evaluated[0].result.status,
  };
};
const line = (description, amount, gstRate) => ({ description, amount, ...(gstRate === undefined ? {} : { gstRate }) });

test("GST Entries: two rates split into two rows, tax = taxable x rate / 2, matching printed totals stay clean", async () => {
  const r = await gstSplit({ lineItems: [line("Paint", 2000, 18), line("Brush", 500, 12), line("Thinner", 1000, 18)], totals: { taxableAmount: 3500, cgst: 300, sgst: 300, grandTotal: 4100 } });
  assert.deepEqual(r.gst, [[3000, 0, 270, 270], [500, 0, 30, 30]]);
  assert.deepEqual(r.yellow, [false, false]);
  assert.equal(r.stock[0].split("\n").length, 2, "STOCK text lists only that rate's lines");
  assert.equal(r.stock[1].split("\n").length, 1);
  assert.doesNotMatch(r.review, /does not match/);
  assert.equal(r.sheet.getCell("E4").value.formula, "SUM(E2:E3)");
});

test("GST Entries: interstate invoice puts the tax in IGST", async () => {
  const supplier = `27AAAPT1111T1Z${gstinCheckChar("27AAAPT1111T1Z")}`;
  const buyer = `29AAAPT2222T1Z${gstinCheckChar("29AAAPT2222T1Z")}`;
  const r = await gstSplit({ supplier: { name: "TEST TRADERS", gstin: supplier }, buyer: { name: "B", gstin: buyer }, lineItems: [line("Paint", 2000, 18), line("Brush", 500, 12)], totals: { taxableAmount: 2500, igst: 420, grandTotal: 2920 } });
  assert.deepEqual(r.gst, [[2000, 360, 0, 0], [500, 60, 0, 0]]);
});

test("GST Entries: printed totals that the rate-wise split cannot reach get a review reason and yellow rows", async () => {
  const r = await gstSplit({ lineItems: [line("Paint", 2000, 18), line("Brush", 500, 12)], totals: { taxableAmount: 2500, cgst: 240, sgst: 240, grandTotal: 2980 } });
  assert.deepEqual(r.gst, [[2000, 0, 180, 180], [500, 0, 30, 30]]);
  assert.match(r.review, /rate-wise split does not match the printed totals: CGST 210\.00 vs printed 240\.00; SGST 210\.00 vs printed 240\.00\./);
  assert.deepEqual(r.yellow, [true, true]);
  // Within the 1.00 round-off tolerance: no reason.
  const close = await gstSplit({ lineItems: [line("Paint", 2000, 18), line("Brush", 500, 12)], totals: { taxableAmount: 2500, cgst: 210.5, sgst: 210.5, grandTotal: 2921 } });
  assert.doesNotMatch(close.review, /does not match/);
});

test("GST Entries: INCOMPLETE invoice is split by rate from its lines, yellow, never inventing a rate", async () => {
  const lines = [line("Paint", 2000, 18), line("Brush", 500, 12), line("Labour", 700)];
  const r = await gstSplit({ continuedOverleaf: true, lineItems: lines });
  assert.equal(r.status, "INCOMPLETE");
  assert.deepEqual(r.gst, [[2000, 0, 180, 180], [500, 0, 30, 30], [700, null, null, null]]);
  assert.deepEqual(r.yellow, [true, true, true]);
  assert.match(r.review, /Tax computed from lines, not printed on the invoice\./);
  assert.match(r.review, /Line 3 \(Labour, 700\): no GST rate written\./);
  // Use computed totals: the rated lines disagree (18% and 12%), so the unrated line stays unrated.
  const chosen = await gstSplit({ continuedOverleaf: true, useComputedTotals: true, lineItems: lines });
  assert.deepEqual(chosen.gst, r.gst);
  // No line has a rate: one row, taxable only.
  const none = await gstSplit({ continuedOverleaf: true, lineItems: [line("Labour", 700), line("Hire", 300)] });
  assert.deepEqual(none.gst, [[1000, null, null, null]]);
  assert.match(none.review, /Line 1: no GST rate written\.\nLine 2: no GST rate written\./);
});

test("GST Entries: 'Use computed totals' gives unrated lines the one common rate, with a review reason", async () => {
  const lines = [line("Paint", 2000, 18), line("Brush", 500, 18), line("Labour", 700)];
  const plain = await gstSplit({ continuedOverleaf: true, lineItems: lines });
  assert.deepEqual(plain.gst, [[2500, 0, 225, 225], [700, null, null, null]]);
  const chosen = await gstSplit({ continuedOverleaf: true, useComputedTotals: true, lineItems: lines });
  assert.deepEqual(chosen.gst, [[3200, 0, 288, 288]]);
  assert.deepEqual(chosen.yellow, [true]);
  assert.match(chosen.review, /Line 3: no GST rate written; 18% \(the rate of the other lines\) used because "Use computed totals" was chosen\./);
});

test("GST Entries: single-rate invoice stays one row with its printed figures", async () => {
  const r = await gstSplit({ lineItems: [line("Film", 900, 18), line("Blinds", 6355, 18), line("Matt", 4200, 18)], totals: { taxableAmount: 11455, cgstRate: 9, cgst: 1030.95, sgstRate: 9, sgst: 1030.95, roundOff: 0.1, grandTotal: 13517 } });
  assert.deepEqual(r.gst, [[11455, 0, 1030.95, 1030.95]]);
  assert.deepEqual(r.yellow, [false]);
});

// The client's saved Rohit 005 (P.T.O.) and Mahavir 101 readings.
test("GST Entries: Rohit 005 splits 18% / no rate; Mahavir 101 stays one row", { skip: !hasSamples && "needs fixtures/invoices/demo/*.json (git-ignored)" }, async () => {
  const read = (name) => JSON.parse(readFileSync(join(demoDir, name), "utf8"));
  const parties = read("parties.json");
  const sample = (name) => {
    const s = read(name);
    return { invoice: s.invoice, sourceFile: s.file };
  };
  const run = async (items) => {
    const workbook = await toWorkbook(evaluate(items, { ...OPTIONS, parties }), parties);
    const sheet = workbook.getWorksheet("GST Entries");
    return { sheet, rows: rows(sheet).filter((r) => r[3] && r[3] !== "TOTAL"), review: rows(workbook.getWorksheet("Review")) };
  };

  const rohit = await run([sample("invoice3.json")]);
  assert.deepEqual(rohit.rows.map((r) => r.slice(3, 8)), [["005", 206429, 0, 18578.61, 18578.61], ["005", 8950, null, null, null]]);
  assert.deepEqual([2, 3].map((n) => rohit.sheet.getCell(`A${n}`).fill?.fgColor?.argb), ["FFFFF2CC", "FFFFF2CC"]);
  assert.equal(rohit.sheet.getCell("E4").value.formula, "SUM(E2:E3)");
  assert.match(rohit.review[0][6], /Tax computed from lines, not printed on the invoice\./);
  assert.match(rohit.review[0][6], /Line 4 \(.+, 8,950\): no GST rate written\./);

  const forced = sample("invoice3.json");
  forced.invoice.useComputedTotals = true;
  const chosen = await run([forced]);
  assert.deepEqual(chosen.rows.map((r) => r.slice(4, 8)), [[215379, 0, 19384.11, 19384.11]]);
  assert.match(chosen.review[0][6], /Line 4: no GST rate written; 18% .* "Use computed totals"/);

  const mahavir = await run([sample("invoice2.json")]);
  assert.deepEqual(mahavir.rows.map((r) => r.slice(3, 8)), [["101", 11455, 0, 1030.95, 1030.95]]);
});

// Lines: one reference row per invoice line, tax = amount x rate (never read back by Tally).
const LINES_YELLOW = "FFFFF2CC";
const linesOf = async (items, parties) => {
  const evaluated = evaluate(items, { ...OPTIONS, parties });
  const workbook = await toWorkbook(evaluated, parties);
  const sheet = workbook.getWorksheet("Lines");
  const body = sheet ? rows(sheet).filter((r) => r[2] !== null && r[4] !== null && r[4] !== "TOTAL").map((r, i) => ({ r, yellow: sheet.getRow(i + 2).getCell(1).fill?.fgColor?.argb === LINES_YELLOW })) : [];
  return { workbook, sheet, body, evaluated, review: rows(workbook.getWorksheet("Review")) };
};
const amounts = (r) => [r[9], r[11], r[12], r[13]]; // AMOUNT, IGST, CGST, SGST

test("Lines: sits after GST Entries, header, TOTAL formulas, clean line numbers, real dates, reference note", async () => {
  const parties = [{ name: "TEST TRADERS", gstin: null, entryType: "STOCK" }];
  const { workbook, sheet, body } = await linesOf([{ invoice: { supplier: { name: "TEST TRADERS" }, invoiceNo: "L-1", invoiceDate: "05/08/2026", lineItems: [{ sno: "4)", description: "Paint", qty: 2, unit: "ltr", rate: 1000, amount: 2000, gstRate: 18 }, { sno: "2.", description: "Brush", amount: 500, gstRate: 12 }], totals: { taxableAmount: 2500, cgst: 210, sgst: 210, grandTotal: 2920 } } }], parties);
  assert.deepEqual(workbook.worksheets.map((s) => s.name).slice(0, 2), ["GST Entries", "Lines"]);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["DATE", "PARTY NAME", "INVOICE NO", "LINE NO", "DESCRIPTION", "HSN/SAC", "QTY", "UNIT", "RATE", "AMOUNT", "GST %", "IGST", "CGST", "SGST"]);
  assert.equal(sheet.getCell("A1").fill?.fgColor?.argb, "FF2F5F5F");
  assert.equal(sheet.getCell("A2").font?.name, "Arial");
  assert.ok(sheet.getCell("A2").value instanceof Date);
  assert.equal(sheet.getCell("A2").numFmt, "dd-mm-yyyy");
  assert.equal(sheet.getCell("J2").numFmt, "#,##0.00");
  assert.deepEqual(body.map((b) => [b.r[3], b.r[7], b.r[10], ...amounts(b.r)]), [[4, "LTR", 18, 2000, 0, 180, 180], [2, null, 12, 500, 0, 30, 30]]);
  assert.deepEqual(body.map((b) => b.yellow), [false, false]);
  assert.deepEqual(["J", "L", "M", "N"].map((c) => sheet.getCell(`${c}4`).value.formula), ["SUM(J2:J3)", "SUM(L2:L3)", "SUM(M2:M3)", "SUM(N2:N3)"]);
  assert.match(sheet.getCell("A6").value, /not a Tally import sheet/);
});

test("Lines: interstate puts the line tax in IGST; a line without a rate is blank and yellow; no lines = no sheet", async () => {
  const supplier = `27AAAPT1111T1Z${gstinCheckChar("27AAAPT1111T1Z")}`;
  const buyer = `29AAAPT2222T1Z${gstinCheckChar("29AAAPT2222T1Z")}`;
  const parties = [{ name: "TEST TRADERS", gstin: null, entryType: "STOCK" }];
  const base = { supplier: { name: "TEST TRADERS", gstin: supplier }, buyer: { name: "B", gstin: buyer }, invoiceNo: "L-2", invoiceDate: "05/08/2026" };
  const inter = await linesOf([{ invoice: { ...base, lineItems: [line("Paint", 2000, 18), line("Brush", 500, 12)], totals: { taxableAmount: 2500, igst: 420, grandTotal: 2920 } } }], parties);
  assert.deepEqual(inter.body.map((b) => amounts(b.r)), [[2000, 360, 0, 0], [500, 60, 0, 0]]);
  assert.deepEqual(inter.body.map((b) => b.yellow), [false, false]);
  const unrated = await linesOf([{ invoice: { ...base, lineItems: [line("Paint", 2000, 18), line("Labour", 700)] } }], parties);
  assert.deepEqual(unrated.body.map((b) => [...amounts(b.r), b.r[10], b.yellow]), [[2000, 360, 0, 0, 18, true], [700, null, null, null, null, true]]);
  const none = await linesOf([{ invoice: { ...base, lineItems: [] } }], parties);
  assert.equal(none.sheet, undefined);
});

test("Lines: a paisa between line tax and GST Entries gets a review note, GST Entries is untouched", async () => {
  const parties = [{ name: "TEST TRADERS", gstin: null, entryType: "STOCK" }];
  // 3 x 33.33 at 18% -> each line CGST 3.00 (2.9997), GST Entries rounds the 99.99 group once: 8.9991 -> 9.00 (no gap); use .5 paise to force one.
  const lines = [line("A", 10.25, 18), line("B", 10.25, 18)]; // 0.9225 each -> 0.92 + 0.92 = 1.84; group 20.5 x 9% = 1.845 -> 1.85
  const r = await linesOf([{ invoice: { supplier: { name: "TEST TRADERS" }, invoiceNo: "L-3", invoiceDate: "05/08/2026", lineItems: lines } }], parties);
  assert.deepEqual(r.workbook.getWorksheet("GST Entries").getCell("G2").value, 1.85);
  assert.deepEqual(r.body.map((b) => b.r[12]), [0.92, 0.92]);
  assert.match(r.review[0][6], /Lines sheet CGST 1\.84 differs from GST Entries CGST 1\.85 by 0\.01/);
});

// The client's saved readings (git-ignored fixtures).
test("Lines: Rohit 006, Ambika, Mahavir 101, Rohit 005 line by line; per-invoice CGST matches GST Entries within 0.05", { skip: !hasSamples && "needs fixtures/invoices/demo/*.json (git-ignored)" }, async () => {
  const read = (name) => JSON.parse(readFileSync(join(demoDir, name), "utf8"));
  const parties = read("parties.json");
  const sample = (name) => {
    const s = read(name);
    return { invoice: s.invoice, sourceFile: s.file };
  };
  const only = async (name, prepare = (s) => s) => linesOf([prepare(sample(name))], parties);
  const forInvoice = (r, no) => r.body.filter((b) => b.r[2] === no);

  const rohit006 = await only("invoice4.json");
  assert.deepEqual(rohit006.body.map((b) => amounts(b.r)), [[35385, 0, 3184.65, 3184.65], [23655, 0, 2128.95, 2128.95]]);
  const ambika = await only("invoice1.json");
  assert.deepEqual(ambika.body.map((b) => amounts(b.r)), [[34000, 0, 3060, 3060], [16000, 0, 1440, 1440]]);
  const mahavir = await only("invoice2.json");
  assert.deepEqual(mahavir.body.map((b) => amounts(b.r)), [[900, 0, 81, 81], [6355, 0, 571.95, 571.95], [4200, 0, 378, 378]]);

  const rohit005 = await only("invoice3.json");
  assert.deepEqual(rohit005.body.map((b) => amounts(b.r)), [[154624, 0, 13916.16, 13916.16], [20800, 0, 1872, 1872], [31005, 0, 2790.45, 2790.45], [8950, null, null, null]]);
  assert.deepEqual(rohit005.body.map((b) => b.yellow), [true, true, true, true], "INCOMPLETE invoice");
  assert.deepEqual(rohit005.body.map((b) => b.r[3]), [1, 2, 3, 4]);

  // "Use computed totals" gives line 4 the 18% and keeps the existing review reason.
  const chosen = await only("invoice3.json", (s) => ({ ...s, invoice: { ...s.invoice, useComputedTotals: true } }));
  assert.deepEqual(chosen.body[3].r.slice(9, 14), [8950, 18, 0, 805.5, 805.5]);
  assert.match(chosen.review[0][6], /Line 4: no GST rate written; 18% .* "Use computed totals"/);

  // All four together: order is by invoice date, and each invoice's line CGST equals its GST Entries CGST.
  const all = await linesOf(["invoice1", "invoice2", "invoice3", "invoice4"].map((n) => sample(`${n}.json`)), parties);
  const gst = rows(all.workbook.getWorksheet("GST Entries")).filter((r) => r[3] && r[3] !== "TOTAL");
  for (const no of new Set(all.body.map((b) => b.r[2]))) {
    const fromLines = forInvoice(all, no).reduce((a, b) => a + (b.r[12] ?? 0), 0);
    const fromGst = gst.filter((r) => r[3] === no).reduce((a, r) => a + (r[6] ?? 0), 0);
    assert.ok(Math.abs(fromLines - fromGst) <= 0.05, `${no}: ${fromLines} vs ${fromGst}`);
  }
});
