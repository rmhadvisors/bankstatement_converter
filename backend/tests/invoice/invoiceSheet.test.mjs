import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { buildInvoiceSheetBuffer } from "../../src/invoice/tallyWorkbook.js";

const entry = (invoice, status = "OK") => ({ invoice, result: { status, computed: { intraState: true, taxable: invoice.totals.taxableAmount ?? null } }, partyName: "GREAT WHITE", salesMode: true, sourceFile: "x.pdf" });

test("invoice export: one GST Entries sheet, a row per line, printed tax kept, Errors only on failure", async () => {
  const invoice = {
    invoiceNo: "1051", invoiceDate: "02/12/2025", buyer: { gstin: "27AAACN1596R1ZR" },
    lineItems: [{ hsnSac: "3920", qty: 68, rate: 55, amount: 3740, gstRate: 18 }, { hsnSac: "6303", qty: 42, rate: 330, amount: 13860, gstRate: 18 }],
    totals: { taxableAmount: 17600, cgst: 1584, sgst: 1584, grandTotal: 20768 },
  };
  const read = async (buffer) => (await new ExcelJS.Workbook().xlsx.load(buffer));
  const one = await read(await buildInvoiceSheetBuffer([entry(invoice)]));
  assert.deepEqual(one.worksheets.map((s) => s.name), ["GST Entries"]);
  const sheet = one.getWorksheet("GST Entries");
  assert.equal(sheet.getRow(2).getCell(5).value, "3920");
  assert.equal(sheet.getRow(2).getCell(6).value, 68);
  assert.equal(sheet.getRow(2).getCell(10).value + sheet.getRow(3).getCell(10).value, 1584); // CGST adds up to the printed figure
  const two = await read(await buildInvoiceSheetBuffer([entry(invoice)], { failed: [{ sourceFile: "bad.pdf", message: "no" }] }));
  assert.deepEqual(two.worksheets.map((s) => s.name), ["GST Entries", "Errors"]);
});
