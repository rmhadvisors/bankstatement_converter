import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, shareBookSeller } from "../../src/invoice/service.js";

test("a bill naming only the buyer is entered under the buyer; a bill book still fills the seller", () => {
  const bill = { invoiceNo: "27/811", buyer: { name: "Acme Pvt Ltd", gstin: "27AAPCA4854J1Z6" } };
  const [entry] = evaluate([{ invoice: bill }], { salesMode: false });
  assert.equal(entry.party.name, "ACME PVT LTD");
  assert.equal(entry.salesMode, true);
  assert.equal(entry.invoice.supplier.name, null);
  assert.ok(!entry.result.reasons.some((r) => r.field === "supplier.name"));

  const printed = { supplier: { name: "Seller Co" }, buyer: { name: "X" } };
  const written = { supplier: { name: null, gstin: null }, buyer: { name: "Acme Pvt Ltd" } };
  shareBookSeller([printed, written]);
  assert.equal(written.supplier.name, "Seller Co");
  assert.equal(written.buyer.name, "Acme Pvt Ltd");
});
