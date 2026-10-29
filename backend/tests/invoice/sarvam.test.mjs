import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";

import { coerce, confidenceMap, SARVAM_SCHEMA, sarvamProvider } from "../../src/invoice/sarvam.js";
import { INVOICE_SCHEMA } from "../../src/invoice/schema.js";
import { extractInvoiceDetailed } from "../../src/invoice/extract.js";

const photo = join(tmpdir(), `invoice-sarvam-${randomUUID()}.png`);
before(async () => writeFile(photo, await createCanvas(600, 800).encode("png")));
after(() => rm(photo, { force: true }));

test("sarvam schema: every field typed and described, depth <= 4, no confidence/unreadable", () => {
  const schema = JSON.parse(SARVAM_SCHEMA);
  const walk = (node, depth, path) => {
    assert.ok(node.type && node.description, `${path} has type and description`);
    assert.ok(depth <= 4, `${path} depth ${depth}`);
    if (node.type === "object") for (const [k, v] of Object.entries(node.properties)) walk(v, depth + 1, `${path}.${k}`);
    if (node.type === "array") walk(node.items, depth + 1, `${path}[]`);
  };
  walk(schema, 1, "root");
  assert.equal(schema.properties.confidence, undefined);
  assert.equal(schema.properties.lineItems.items.properties.qty.type, "number");
  assert.deepEqual(schema.properties.documentType.enum, ["tax_invoice", "bill_of_supply", "receipt", "cash_memo", "other"]);
});

test("sarvam mapping: Indian-format numbers, empty strings, numeric invoice no.; confidence 0..1 to medium/low", () => {
  const mapped = coerce(INVOICE_SCHEMA, { invoiceNo: 101, totals: { grandTotal: "1,54,624.00", cgst: "" }, lineItems: [{ qty: "15", amount: "Rs. 900/-" }], continuedOverleaf: "yes" });
  assert.deepEqual([mapped.invoiceNo, mapped.totals.grandTotal, mapped.totals.cgst, mapped.lineItems[0].qty, mapped.lineItems[0].amount, mapped.continuedOverleaf], ["101", 154624, null, 15, 900, true]);
  assert.equal(coerce(INVOICE_SCHEMA, { totals: { grandTotal: "illegible" } }).totals.grandTotal, "illegible", "left for the schema check to reject");
  const confidence = confidenceMap({ invoiceNo: { confidence: 0.97 }, lineItems: [{ hsnSac: { confidence: 0.4 } }, { rate: { confidence: 0.7 } }], totals: { grandTotal: { confidence: 99 } } });
  assert.deepEqual(confidence, { "lineItems[0].hsnSac": "low", "lineItems[1].rate": "medium" });
});

test("sarvam provider: submit, poll until terminal, fetch results; key header; errors", async () => {
  const calls = [];
  const statuses = ["pending", "running", "completed"];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", key: init.headers?.["api-subscription-key"], schema: init.body?.get?.("schema") });
    if (url.endsWith("/extract")) return Response.json({ job_id: "job-1", status: "pending", run_id: "r" }, { status: 201 });
    if (url.endsWith("/status")) return Response.json({ job_id: "job-1", status: statuses.shift(), usage: { pages_total: 1 } });
    return Response.json({ type: "extract", status: "completed", result: { invoiceNo: "7", totals: { grandTotal: 1180 } }, annotations: { invoiceNo: { confidence: 0.5 } }, usage: { pages_total: 1 } });
  };
  const sarvam = sarvamProvider({ apiKey: "k", fetchImpl, sleep: async () => {}, pollMs: 0 });
  const { invoice, meta } = await extractInvoiceDetailed({ name: "bill.png", path: photo }, { providerName: "sarvam", sarvam });
  assert.equal(invoice.invoiceNo, "7");
  assert.equal(invoice.totals.grandTotal, 1180);
  assert.deepEqual(invoice.confidence, { invoiceNo: "low" });
  assert.deepEqual(meta, { provider: "sarvam", pages: 1, partial: false });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("https://api.sarvam.ai/doc-ai/v1/job", "")}`), ["POST /extract", "GET /job-1/status", "GET /job-1/status", "GET /job-1/status", "GET /job-1/results?format=json"]);
  assert.ok(calls.every((c) => c.key === "k"));
  assert.equal(calls[0].schema, SARVAM_SCHEMA);

  const failing = sarvamProvider({ apiKey: "k", sleep: async () => {}, pollMs: 0, fetchImpl: async (url) => (url.endsWith("/extract") ? Response.json({ job_id: "j" }, { status: 201 }) : Response.json({ status: "failed" })) });
  await assert.rejects(failing.extract({ name: "a.jpg", buffer: Buffer.from("x"), mediaType: "image/jpeg" }), { code: "SARVAM_JOB_FAILED" });
  await assert.rejects(sarvamProvider({ apiKey: "" }).extract({ name: "a", buffer: Buffer.from("x") }), { code: "SARVAM_KEY_MISSING" });
});

test("sarvam_then_claude: Claude only when Sarvam's reading fails the checks or is low-confidence", async () => {
  const sarvamWith = (result, annotations = {}) =>
    sarvamProvider({
      apiKey: "k",
      sleep: async () => {},
      pollMs: 0,
      fetchImpl: async (url) =>
        url.endsWith("/extract") ? Response.json({ job_id: "j" }, { status: 201 }) : url.endsWith("/status") ? Response.json({ status: "completed" }) : Response.json({ result, annotations, usage: { pages_total: 1 } }),
    });
  const claude = { calls: 0, complete: async function () { this.calls++; return { text: JSON.stringify({ invoiceNo: "FROM-CLAUDE", invoiceDate: "01/08/2026", supplier: { name: "X" } }), usage: { model: "m", inputTokens: 10, outputTokens: 5 } }; } };
  const good = { invoiceNo: "1", invoiceDate: "01/08/2026", supplier: { name: "X" }, totals: { taxableAmount: 100, grandTotal: 100 } };

  const kept = await extractInvoiceDetailed({ name: "bill.png", path: photo }, { providerName: "sarvam_then_claude", sarvam: sarvamWith(good), provider: claude });
  assert.equal(kept.meta.provider, "sarvam");
  assert.equal(claude.calls, 0);

  const lowConfidence = await extractInvoiceDetailed({ name: "bill.png", path: photo }, { providerName: "sarvam_then_claude", sarvam: sarvamWith(good, { invoiceNo: { confidence: 0.3 } }), provider: claude });
  assert.deepEqual([lowConfidence.meta.provider, lowConfidence.meta.fallback, lowConfidence.meta.fallbackReason, lowConfidence.invoice.invoiceNo], ["claude", true, "Sarvam marked fields low-confidence", "FROM-CLAUDE"]);

  const failsChecks = await extractInvoiceDetailed({ name: "bill.png", path: photo }, { providerName: "sarvam_then_claude", sarvam: sarvamWith({ ...good, totals: { taxableAmount: 100, grandTotal: 999 } }), provider: claude });
  assert.equal(failsChecks.meta.fallbackReason, "checks failed on the Sarvam reading");
});

test("sarvam: confidence flags on empty fields are dropped (only read values can be doubtful)", async () => {
  const sarvam = sarvamProvider({
    apiKey: "k",
    sleep: async () => {},
    pollMs: 0,
    fetchImpl: async (url) =>
      url.endsWith("/extract")
        ? Response.json({ job_id: "j" }, { status: 201 })
        : url.endsWith("/status")
          ? Response.json({ status: "completed" })
          : Response.json({ result: { invoiceNo: "9", lineItems: [{ hsnSac: "3120" }] }, annotations: { invoiceNo: { confidence: 0.3 }, challanNo: { confidence: 0.1 }, lineItems: [{ hsnSac: { confidence: 0.2 }, discount: { confidence: 0.1 } }] } }),
  });
  const { invoice } = await extractInvoiceDetailed({ name: "bill.png", path: photo }, { providerName: "sarvam", sarvam });
  assert.deepEqual(invoice.confidence, { invoiceNo: "low", "lineItems[0].hsnSac": "low" });
});
