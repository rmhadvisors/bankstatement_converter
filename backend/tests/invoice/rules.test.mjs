import assert from "node:assert/strict";
import test from "node:test";

import { applyReadingRules } from "../../src/invoice/rules.js";
import { validateInvoiceJson } from "../../src/invoice/schema.js";
import { validateInvoice } from "../../src/invoice/validate.js";

const reading = (fields) => validateInvoiceJson(fields).invoice;

test("rules: qty/unit from the description, GST rate from the totals, computed round-off", () => {
  const { invoice, derived } = applyReadingRules(
    reading({
      lineItems: [
        { description: "Wall works increased area 966.45 sq ft", rate: 160, amount: 154624 },
        { description: "Blinds 15 SQFT", rate: 60, amount: 900 },
        { description: "Labour 3 nos and JCB 2 hours lump sum", amount: 8950 },
        { description: "Paint 100 KGS", qty: 100, unit: "KGS", rate: 160, amount: 16000 },
        { description: "Coba", qty: 337, unit: "Sq. Ft", rate: 105, amount: 35385 },
      ],
      totals: { taxableAmount: 215859, cgstRate: 9, sgstRate: 9, cgst: 19427.31, sgst: 19427.31, grandTotal: 254713.7 },
    }),
  );
  assert.deepEqual(invoice.lineItems.map((l) => [l.qty, l.unit]), [[966.45, "sqft"], [15, "sqft"], [3, "NOS"], [100, "KGS"], [337, "sqft"]]);
  assert.ok(invoice.lineItems.every((l) => l.gstRate === 18));
  assert.equal(invoice.totals.roundOff, 0.08);
  assert.equal(invoice.confidence["lineItems[0].qty"], "medium");
  assert.ok(derived.some((d) => /qty 966.45 sqft taken from the description/.test(d)));
  assert.ok(derived.some((d) => /GST 18% applied to all lines/.test(d)));
});

test("rules: two quantities in one description are ambiguous and left empty; no round-off stays blank", () => {
  const { invoice } = applyReadingRules(reading({ lineItems: [{ description: "10 sqft and 20 sqft", amount: 100 }], totals: { taxableAmount: 100, grandTotal: 100 } }));
  assert.equal(invoice.lineItems[0].qty, null);
  assert.equal(invoice.totals.roundOff, null);
});

test("rules: payment status ignores the model's guess and compares the written amount", () => {
  const status = (payment, grandTotal = 69667.2) => applyReadingRules(reading({ payment, totals: { grandTotal } })).invoice.payment;
  assert.equal(status({ status: "unpaid" }).status, null, "no payment note: blank, whatever the model said");
  assert.equal(status({ status: "paid", mode: "Cheque", reference: "0095" }).status, "paid", "note without amount");
  assert.equal(status({ status: "paid", mode: "NEFT", amount: 69077 }).status, "partial", "short by 590.20");
  assert.equal(status({ status: "partial", amount: 69667.2 }).status, "paid");
  const amountAsReference = status({ mode: "NEFT", amount: 69077, reference: "69077" });
  assert.equal(amountAsReference.reference, null, "the amount is never the reference");
  assert.equal(status({ mode: "Cheque", reference: "0095", amount: 13517 }, 13517).reference, "0095");
});

test("validation: P.T.O. makes an invoice INCOMPLETE only when its totals are blank", () => {
  const base = { supplier: { name: "X" }, invoiceNo: "1", invoiceDate: "01/08/2026", continuedOverleaf: true, lineItems: [{ qty: 1, rate: 100, amount: 100 }] };
  assert.equal(validateInvoice(reading({ ...base, totals: {} })).status, "INCOMPLETE");
  const complete = validateInvoice(reading({ ...base, totals: { taxableAmount: 100, grandTotal: 100 } }));
  assert.equal(complete.status, "OK");
  assert.ok(complete.reasons.some((r) => /Marked P.T.O., but the totals are on this page/.test(r.message)));
});
