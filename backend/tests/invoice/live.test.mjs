import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { extractInvoiceDetailed } from "../../src/invoice/extract.js";
import { evaluate } from "../../src/invoice/service.js";

// Live AI reading of the client's 4 samples, compared field by field with the hand-typed JSON, per
// provider. Uses paid APIs, so it runs only with INVOICE_LIVE_TEST=1; providers come from
// INVOICE_LIVE_PROVIDERS (default "claude"), each skipped without its key. Samples, expectations,
// recorded readings and the report stay in the git-ignored fixtures folder.
const invoicesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "invoices");
const demoDir = join(invoicesDir, "demo");
const SAMPLES = ["invoice1", "invoice2", "invoice3", "invoice4"];
const ready = SAMPLES.every((name) => existsSync(join(demoDir, `${name}.json`)));
const PROVIDERS = (process.env.INVOICE_LIVE_PROVIDERS || "claude").split(",").map((p) => p.trim()).filter(Boolean);
const KEYS = { claude: ["INVOICE_LLM_API_KEY"], gemini: ["GEMINI_API_KEY"], sarvam: ["SARVAM_API_KEY"], sarvam_then_claude: ["SARVAM_API_KEY", "INVOICE_LLM_API_KEY"] };
// Prices: Sarvam Document Extraction ₹1.00/page (ex GST); Claude per million tokens (input, output).
const SARVAM_INR_PER_PAGE = 1;
const CLAUDE_USD_PER_MTOK = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
// Gemini paid tier (ai.google.dev/gemini-api/docs/pricing, 30/10/2026); 3.8 Flash doubles from 01/01/2027.
const GEMINI_USD_PER_MTOK = { "gemini-3.8-flash": [0.75, 3.75], "gemini-3.5-flash-lite": [0.3, 2.5] };

const FIELDS = ["supplier.name", "supplier.gstin", "buyer.name", "buyer.gstin", "invoiceNo", "invoiceDate", "placeOfSupply", "continuedOverleaf"];
const LINE_FIELDS = ["description", "hsnSac", "qty", "unit", "rate", "amount", "gstRate"];
const TOTAL_FIELDS = ["taxableAmount", "cgstRate", "cgst", "sgstRate", "sgst", "igst", "roundOff", "grandTotal", "amountInWords"];
const PAYMENT_FIELDS = ["status", "mode", "reference", "date", "amount"];

const get = (obj, path) => path.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const norm = (v) => (v === undefined || v === "" || v === false ? null : typeof v === "string" ? v.replace(/[\s.,'"-]+/g, " ").trim().toUpperCase() : v);
const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : norm(a) === norm(b));

function compare(expected, extracted) {
  const lines = Math.max(expected.lineItems?.length ?? 0, extracted.lineItems?.length ?? 0);
  const paths = [
    ...FIELDS,
    ...Array.from({ length: lines }, (_, i) => LINE_FIELDS.map((f) => `lineItems[${i}].${f}`)).flat(),
    ...TOTAL_FIELDS.map((f) => `totals.${f}`),
    ...PAYMENT_FIELDS.map((f) => `payment.${f}`),
  ];
  // Fields empty in both are left out: they say nothing about reading accuracy.
  return paths
    .map((path) => ({ path, want: get(expected, path) ?? null, got: get(extracted, path) ?? null, confidence: extracted.confidence?.[path] ?? "" }))
    .filter((r) => norm(r.want) !== null || norm(r.got) !== null)
    .map((r) => ({ ...r, match: same(r.want, r.got) }));
}

function cost(meta) {
  const parts = [];
  let inr = 0;
  let usd = 0;
  const pages = meta.provider === "sarvam" ? meta.pages : meta.sarvamPages;
  if (pages) {
    inr += pages * SARVAM_INR_PER_PAGE;
    parts.push(`Sarvam ${pages} page(s) = ₹${(pages * SARVAM_INR_PER_PAGE).toFixed(2)}`);
  }
  if (meta.usage) {
    const [inPrice, outPrice] = { ...CLAUDE_USD_PER_MTOK, ...GEMINI_USD_PER_MTOK }[meta.usage.model?.replace(/-\d{8}$/, "")] ?? [NaN, NaN];
    usd += (meta.usage.inputTokens * inPrice + meta.usage.outputTokens * outPrice) / 1e6;
    parts.push(`${meta.provider === "gemini" ? "Gemini" : "Claude"} ${meta.usage.model} ${meta.usage.inputTokens} in + ${meta.usage.outputTokens} out tokens = $${usd.toFixed(4)}`);
  }
  return { text: parts.join(" + ") || "n/a", inr, usd };
}

for (const providerName of PROVIDERS) {
  const missing = (KEYS[providerName] ?? ["unknown provider"]).filter((key) => !process.env[key]);
  const skip = process.env.INVOICE_LIVE_TEST !== "1" ? "set INVOICE_LIVE_TEST=1 to run (uses paid AI services)" : !ready ? "needs fixtures/invoices/demo/*.json" : missing.length ? `needs ${missing.join(", ")}` : false;
  test(`live reading (${providerName}) of the 4 sample invoices vs the hand-typed values`, { skip, timeout: 30 * 60 * 1000 }, async () => {
    const report = [`# Provider: ${providerName}${providerName === "gemini" ? ` (model ${process.env.GEMINI_MODEL || "gemini-3.8-flash"})` : providerName !== "sarvam" ? ` (Claude model ${process.env.INVOICE_LLM_MODEL || "claude-sonnet-5-5"})` : ""}`];
    const summary = [];
    const extracted = [];
    for (const name of SAMPLES) {
      const sample = JSON.parse(readFileSync(join(demoDir, `${name}.json`), "utf8"));
      const started = Date.now();
      let read;
      try {
        read = await extractInvoiceDetailed({ name: sample.file, path: join(invoicesDir, sample.file) }, { providerName });
      } catch (error) {
        report.push(`\n## ${name} (${sample.file}): FAILED ${error.code ?? ""} ${error.message}`);
        summary.push({ name, file: sample.file, correct: 0, total: 0, wrong: ["(read failed)"], cost: "n/a", seconds: (Date.now() - started) / 1000, status: "FAILED" });
        extracted.push(null);
        continue;
      }
      const seconds = (Date.now() - started) / 1000;
      writeFileSync(join(demoDir, `${name}.${providerName}.live.json`), JSON.stringify({ file: sample.file, seconds, meta: read.meta, invoice: read.invoice }, null, 1));
      extracted.push({ invoice: read.invoice, sourceFile: sample.file });
      const rows = compare(sample.invoice, read.invoice);
      const c = cost(read.meta);
      report.push(`\n## ${name} (${sample.file}): ${rows.filter((r) => r.match).length}/${rows.length} fields correct, ${seconds.toFixed(0)} s, ${c.text}${read.meta.fallback ? ` | fell back to Claude: ${read.meta.fallbackReason}` : read.meta.fallbackReason ? ` | Claude fallback wanted (${read.meta.fallbackReason}) but failed: ${read.meta.fallbackError}` : ""}`);
      for (const r of rows) report.push(`${r.match ? "  correct" : "  WRONG  "} ${r.path.padEnd(26)} expected ${JSON.stringify(r.want)}  |  read ${JSON.stringify(r.got)}${r.confidence ? `  [${r.confidence} confidence]` : ""}`);
      report.push(`  handwritten notes read: ${JSON.stringify(read.invoice.handwrittenNotes)}`);
      summary.push({ name, file: sample.file, correct: rows.filter((r) => r.match).length, total: rows.length, wrong: rows.filter((r) => !r.match).map((r) => r.path), cost: c.text, seconds });
    }
    const parties = existsSync(join(demoDir, "parties.json")) ? JSON.parse(readFileSync(join(demoDir, "parties.json"), "utf8")) : [];
    const readOk = extracted.filter(Boolean);
    const results = evaluate(readOk, { financialYear: "2026-27", parties });
    report.push("\n## Checks run on this provider's reading");
    let k = 0;
    extracted.forEach((item, i) => {
      if (!item) return;
      const r = results[k++];
      summary[i].status = r.result.status;
      report.push(`  ${SAMPLES[i]}: ${r.result.status} | ${r.result.reasons.map((x) => x.message).join(" / ")}`);
    });
    const text = report.join("\n");
    writeFileSync(join(demoDir, `live-report.${providerName}.txt`), text);
    writeFileSync(join(demoDir, `live-summary.${providerName}.json`), JSON.stringify(summary, null, 1));
    console.log(text);
  });
}
