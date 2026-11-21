import assert from "node:assert/strict";
import { test } from "node:test";
import { shareBookSeller } from "../../src/invoice/service.js";

test("bill book: written customer becomes buyer, seller comes from the printed bill", () => {
  const printed = { supplier: { name: "MAHAVIR DECOR", gstin: "27ACGPK4033P1ZB" }, buyer: { name: "SSAYA TECHNOLOGIES" } };
  const written = { supplier: { name: "GREAT WHITE TECHNOLOGIES", gstin: "27AAACN1596R1ZR" }, buyer: { name: null } };
  const own = { supplier: { name: "MAHAVIR DECOR", gstin: "27ACGPK4033P1ZB" }, buyer: { name: null } };
  shareBookSeller([printed, written, own]);
  assert.equal(written.supplier.name, "MAHAVIR DECOR");
  assert.equal(written.buyer.name, "GREAT WHITE TECHNOLOGIES");
  assert.equal(written.buyer.gstin, "27AAACN1596R1ZR");
  assert.equal(own.buyer.name, null); // already the seller's: untouched
  const alone = { supplier: { name: "X" }, buyer: { name: null } };
  shareBookSeller([alone]); // no printed bill: nothing guessed
  assert.equal(alone.supplier.name, "X");
});
