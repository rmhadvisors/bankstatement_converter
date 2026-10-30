import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";

import { claudeProvider, extractInvoice, SYSTEM_PROMPT } from "../../src/invoice/extract.js";

// The model call is mocked here; the live run is a separate, key-gated script.
const photo = join(tmpdir(), `invoice-extract-${randomUUID()}.png`);
before(async () => writeFile(photo, await createCanvas(600, 800).encode("png")));
after(() => rm(photo, { force: true }));

const reply = (invoice) => JSON.stringify(invoice);
const mockProvider = (replies) => {
  const calls = [];
  return { calls, complete: async (request) => (calls.push(structuredClone(request)), replies.shift()) };
};

test("extract: a schema-valid reply is normalized; the image goes in the request", async () => {
  const provider = mockProvider([`Here you go:\n${reply({ invoiceNo: "7", totals: { grandTotal: 1180 } })}`]);
  const invoice = await extractInvoice({ name: "bill.png", path: photo }, { provider });
  assert.equal(invoice.invoiceNo, "7");
  assert.equal(invoice.totals.grandTotal, 1180);
  assert.equal(invoice.supplier.gstin, null);
  const [first] = provider.calls;
  assert.equal(first.system, SYSTEM_PROMPT);
  assert.equal(first.messages[0].content[0].type, "image");
  assert.equal(first.messages[0].content[0].source.media_type, "image/jpeg");
});

test("extract: an invalid reply is retried once with the errors; twice invalid is an error", async () => {
  const provider = mockProvider([reply({ totals: { grandTotal: "1,180" } }), reply({ totals: { grandTotal: 1180 } })]);
  const invoice = await extractInvoice({ name: "bill.png", path: photo }, { provider });
  assert.equal(invoice.totals.grandTotal, 1180);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1].messages.at(-1).content, /totals\.grandTotal: expected number/);

  const bad = mockProvider(["not json at all", "still not json"]);
  await assert.rejects(extractInvoice({ name: "bill.png", path: photo }, { provider: bad }), { code: "INVOICE_LLM_BAD_JSON" });
});

test("claude provider: request shape, retry on 429, refusal and missing key", async () => {
  const requests = [];
  let first = true;
  const fetchImpl = async (url, init) => {
    requests.push({ url, init: { ...init, body: JSON.parse(init.body) } });
    if (first) {
      first = false;
      return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    }
    return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });
  };
  const provider = claudeProvider({ apiKey: "test-key", model: "test-model", fetchImpl });
  assert.equal((await provider.complete({ system: "s", messages: [{ role: "user", content: "x" }] })).text, "{}");
  assert.equal(requests.length, 2, "429 retried");
  const { url, init } = requests[1];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], "test-key");
  assert.equal(init.body.model, "test-model");
  assert.equal(init.body.temperature, undefined);
  assert.ok(init.signal, "per-request timeout");

  const refusing = claudeProvider({ apiKey: "k", fetchImpl: async () => Response.json({ stop_reason: "refusal", content: [] }) });
  await assert.rejects(refusing.complete({ system: "s", messages: [] }), { code: "INVOICE_LLM_REFUSED" });
  await assert.rejects(claudeProvider({ apiKey: "" }).complete({ system: "s", messages: [] }), { code: "INVOICE_KEY_MISSING" });
});

test("gemini provider: structured-output request, confidence list -> map, usage, same checks as Claude", async () => {
  const { geminiProvider, GEMINI_SCHEMA } = await import("../../src/invoice/gemini.js");
  const requests = [];
  const answer = { invoiceNo: "7", totals: { grandTotal: 118 }, confidence: [{ field: "invoiceNo", level: "low" }] };
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 }, modelVersion: "gemini-test" });
  };
  const provider = geminiProvider({ apiKey: "k", model: "gemini-test", fetchImpl });
  const invoice = await extractInvoice({ name: "a.png", path: photo }, { providerName: "gemini", provider });
  assert.equal(invoice.invoiceNo, "7");
  assert.deepEqual(invoice.confidence, { invoiceNo: "low" });

  const [request] = requests;
  assert.match(request.url, /\/models\/gemini-test:generateContent$/);
  assert.equal(request.headers["x-goog-api-key"], "k");
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(request.body.generationConfig.responseSchema, JSON.parse(JSON.stringify(GEMINI_SCHEMA)));
  assert.equal(GEMINI_SCHEMA.properties.useComputedTotals, undefined);
  assert.deepEqual(GEMINI_SCHEMA.properties.totals.properties.grandTotal, { type: "number", nullable: true });
  assert.equal(request.body.contents[0].parts[0].inlineData.mimeType, "image/jpeg");
  assert.equal(request.body.systemInstruction.parts[0].text.startsWith(SYSTEM_PROMPT), true);

  const direct = await provider.complete({ system: "s", messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(direct.usage, { model: "gemini-test", inputTokens: 1000, outputTokens: 500 });

  const blocked = geminiProvider({ apiKey: "k", fetchImpl: async () => Response.json({ candidates: [{ finishReason: "SAFETY" }] }) });
  await assert.rejects(blocked.complete({ system: "s", messages: [{ role: "user", content: "x" }] }), { code: "INVOICE_LLM_REFUSED" });
  await assert.rejects(geminiProvider({ apiKey: "" }).complete({ system: "s", messages: [] }), { code: "GEMINI_KEY_MISSING" });
});
