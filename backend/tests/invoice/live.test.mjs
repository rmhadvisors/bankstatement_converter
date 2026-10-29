import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { extractInvoice } from "../../src/invoice/extract.js";
import { evaluate } from "../../src/invoice/service.js";

// Live AI reading of the client's 4 samples, compared field by field with the hand-typed JSON.
// Costs API calls, so it runs only with INVOICE_LLM_API_KEY set AND INVOICE_LIVE_TEST=1. Samples,
// expectations and the recorded readings stay in the git-ignored fixtures folder.
const invoicesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "invoices");
const demoDir = join(invoicesDir, "demo");
const SAMPLES = ["invoice1", "invoice2", "invoice3", "invoice4"];
const ready = SAMPLES.every((name) => existsSync(join(demoDir, `${name}.json`)));
const skip = !process.env.INVOICE_LLM_API_KEY ? "needs INVOICE_LLM_API_KEY" : process.env.INVOICE_LIVE_TEST !== "1" ? "set INVOICE_LIVE_TEST=1 to run (uses the AI service)" : !ready ? "needs fixtures/invoices/demo/*.json" : false;

const FIELDS = ["supplier.name", "supplier.gstin", "buyer.name", "buyer.gstin", "invoiceNo", "invoiceDate", "placeOfSupply", "continuedOverleaf"];
const LINE_FIELDS = ["description", "hsnSac", "qty", "unit", "rate", "amount", "gstRate"];
const TOTAL_FIELDS = ["taxableAmount", "cgstRate", "cgst", "sgstRate", "sgst", "igst", "roundOff", "grandTotal", "amountInWords"];
const PAYMENT_FIELDS = ["status", "mode", "reference", "date", "amount"];

const get = (obj, path) => path.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const norm = (v) => (v === undefined || v === "" ? null : typeof v === "string" ? v.replace(/\s+/g, " ").trim().toUpperCase() : v);
const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : norm(a) === norm(b));

function compare(expected, extracted) {
  const paths = [
    ...FIELDS,
    ...Array.from({ length: Math.max(expected.lineItems.length, extracted.lineItems.length) }, (_, i) => LINE_FIELDS.map((f) => `lineItems[${i}].${f}`)).flat(),
    ...TOTAL_FIELDS.map((f) => `totals.${f}`),
    ...PAYMENT_FIELDS.map((f) => `payment.${f}`),
  ];
  return paths.map((path) => {
    const want = get(expected, path) ?? null;
    const got = get(extracted, path) ?? null;
    return { path, want, got, match: same(want, got), confidence: extracted.confidence?.[path] ?? "" };
  });
}

test("live AI reading of the 4 sample invoices vs the hand-typed values", { skip, timeout: 15 * 60 * 1000 }, async () => {
  const report = [];
  const extracted = [];
  for (const name of SAMPLES) {
    const sample = JSON.parse(readFileSync(join(demoDir, `${name}.json`), "utf8"));
    const started = Date.now();
    const invoice = await extractInvoice({ name: sample.file, path: join(invoicesDir, sample.file) });
    writeFileSync(join(demoDir, `${name}.live.json`), JSON.stringify({ file: sample.file, model: process.env.INVOICE_LLM_MODEL || "claude-sonnet-5-5", seconds: (Date.now() - started) / 1000, invoice }, null, 1));
    extracted.push({ invoice, sourceFile: sample.file });
    const rows = compare(sample.invoice, invoice);
    report.push(`\n=== ${sample.file} (${((Date.now() - started) / 1000).toFixed(0)} s): ${rows.filter((r) => r.match).length}/${rows.length} fields match`);
    for (const r of rows) {
      if (r.want === null && r.got === null) continue;
      report.push(`${r.match ? "  ok  " : "  DIFF"} ${r.path.padEnd(26)} expected ${JSON.stringify(r.want)}  |  read ${JSON.stringify(r.got)}${r.confidence ? `  [${r.confidence}]` : ""}`);
    }
    report.push(`  notes read: ${JSON.stringify(invoice.handwrittenNotes)}  unreadable: ${JSON.stringify(invoice.unreadable)}`);
  }
  const parties = existsSync(join(demoDir, "parties.json")) ? JSON.parse(readFileSync(join(demoDir, "parties.json"), "utf8")) : [];
  const results = evaluate(extracted, { financialYear: "2026-27", parties });
  report.push("\n=== validation on the AI reading");
  results.forEach((r, i) => report.push(`  ${SAMPLES[i]}: ${r.result.status} | ${r.result.reasons.map((x) => x.message).join(" / ")}`));
  const text = report.join("\n");
  writeFileSync(join(demoDir, "live-report.txt"), text);
  console.log(text);

  // The fields that matter for the Tally export must be read correctly.
  const expectations = SAMPLES.map((name) => JSON.parse(readFileSync(join(demoDir, `${name}.json`), "utf8")).invoice);
  extracted.forEach(({ invoice }, i) => {
    for (const path of ["invoiceNo", "invoiceDate", "supplier.gstin", "totals.grandTotal", "totals.taxableAmount"]) {
      assert.ok(same(get(expectations[i], path) ?? null, get(invoice, path) ?? null), `${SAMPLES[i]} ${path}`);
    }
  });
});
