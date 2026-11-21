import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReadingRules } from "../../src/invoice/rules.js";

test("rules: HSN read as qty moves to HSN, qty = amount/rate, taxable and GST rate from CGST/SGST", () => {
  const { invoice } = applyReadingRules({
    lineItems: [{ description: "flim", qty: 3920, rate: 55, amount: 3740 }, { description: "Blinds", qty: 6303, rate: 330, amount: 13860 }],
    totals: { cgst: 1584, sgst: 1584, grandTotal: 20768 },
  });
  assert.deepEqual(invoice.lineItems.map((l) => [l.hsnSac, l.qty]), [["3920", 68], ["6303", 42]]);
  assert.equal(invoice.totals.taxableAmount, 17600);
  assert.equal(invoice.totals.cgstRate, 9);
  assert.equal(invoice.lineItems[0].gstRate, 18);
});

test("rules: CGST/SGST from taxable amount and rate", () => {
  const { invoice } = applyReadingRules({ lineItems: [], totals: { taxableAmount: 10000, cgstRate: 9, sgstRate: 9 } });
  assert.equal(invoice.totals.cgst, 900);
  assert.equal(invoice.totals.sgst, 900);
});
