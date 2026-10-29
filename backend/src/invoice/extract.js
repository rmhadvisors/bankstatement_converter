// AI reading of invoices: extractInvoice(file) -> InvoiceJSON. The model only transcribes; every
// figure is re-checked in validate.js. The provider is swappable (tests use a mock); the default is
// Claude over the Messages API with plain fetch. Nothing here logs invoice contents.
import { writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareInvoiceFile } from "./images.js";
import { readFile } from "node:fs/promises";
import { INVOICE_SCHEMA, validateInvoiceJson } from "./schema.js";
import { sarvamProvider } from "./sarvam.js";
import { validateInvoice } from "./validate.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = Number(process.env.INVOICE_LLM_TIMEOUT_MS) || 180_000;
const CONCURRENCY = Number(process.env.INVOICE_LLM_CONCURRENCY) || 2;
const MAX_HTTP_RETRIES = 2;

const extractError = (code, message) => Object.assign(new Error(message), { code });

// Skeleton of the expected JSON, generated from the schema so prompt and validator never drift.
function skeleton(schema) {
  if (typeof schema === "string") return schema.replace("|", " or ") + " or null";
  if (schema.oneOf) return `one of ${schema.oneOf.map((v) => JSON.stringify(v)).join(" | ")} or null`;
  if (Array.isArray(schema)) return [skeleton(schema[0])];
  if (schema["*"]) return { "<field path>": "medium | low" };
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, skeleton(value)]));
}

const SYSTEM_PROMPT = `You transcribe Indian GST invoices, bills and receipts (printed or handwritten, often phone photos of carbon copies with stamps, signatures and notes) into JSON for an accountant. The accountant re-checks every number in code, so your only job is to copy exactly what is written.

Rules:
- Return ONLY one JSON object matching the shape below. No prose, no code fences.
- Copy values as written. Never calculate, correct, complete or guess a value. If a written amount looks wrong (e.g. qty x rate does not match the amount), still copy the written amount.
- A value you cannot read, or that is not on the document, is null. For every unreadable value add {"field": "<path>", "reason": "<why>"} to "unreadable".
- Numbers are plain JSON numbers without commas or currency: "1,54,624.00" -> 154624, "Rs. 59,000/-" -> 59000.
- Dates as dd/mm/yyyy. Write a two-digit year as 20yy.
- GSTIN exactly as printed (15 characters), upper case. Do not fix a GSTIN that looks wrong.
- supplier = the business that issued the invoice (letterhead / "From"); buyer = billed to.
- lineItems: one entry per printed row. taxableValue only if the invoice has a separate taxable-value column; otherwise put the row total in amount. A lump-sum row with no qty/rate has qty and rate null.
- gstRate per line as a total percentage (CGST 9% + SGST 9% -> 18) only if printed on the line or clearly stated for all lines.
- totals: copy the totals block. If the totals area is blank, leave those values null.
- payment: fill from printed or handwritten payment notes ("Recd by Chq 0095 dt 04/08/26", "NEFT 69,077 recd 20/08") - amount, mode, reference, date as written; status "paid" only if the note says the full amount was received.
- handwrittenNotes: transcribe every handwritten annotation that is not part of the printed form, verbatim.
- continuedOverleaf: true if the page says "P.T.O.", "continued" or the totals are on another page that is not included.
- confidence: list ONLY fields you are unsure of, as "<field path>": "medium" or "low". Paths look like "supplier.gstin", "lineItems[0].hsnSac", "totals.grandTotal". Handwritten digits you had to interpret are at least "medium".
- documentType: "tax_invoice" if it says Tax Invoice, otherwise the closest of the allowed values.

Shape:
${JSON.stringify(skeleton(INVOICE_SCHEMA), null, 1)}`;

// ---- Claude provider (plain fetch) ----
function claudeProvider({ apiKey = process.env.INVOICE_LLM_API_KEY, model = process.env.INVOICE_LLM_MODEL || DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  return {
    name: `claude:${model}`,
    async complete({ system, messages }) {
      if (!apiKey) throw extractError("INVOICE_KEY_MISSING", "AI reading is not configured (INVOICE_LLM_API_KEY is not set).");
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetchImpl(API_URL, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2026-10-21",
              // Server-side fallback if the model declines (routes by refusal category).
              "anthropic-beta": "server-side-fallback-2026-07-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({ model, max_tokens: 16000, system, messages, fallbacks: "default" }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          if (error?.name === "TimeoutError") throw extractError("INVOICE_LLM_TIMEOUT", `The AI service did not answer within ${Math.round(TIMEOUT_MS / 1000)} s.`);
          if (attempt < MAX_HTTP_RETRIES) continue;
          throw extractError("INVOICE_LLM_UNREACHABLE", "Could not reach the AI service.");
        }
        // Rate limit / overload / server error: wait (retry-after when given) and try again.
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_HTTP_RETRIES) {
          const wait = Number(response.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30_000)));
          continue;
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) throw extractError("INVOICE_LLM_FAILED", `AI service error ${response.status}: ${body?.error?.message ?? response.statusText}`);
        if (body.stop_reason === "refusal") throw extractError("INVOICE_LLM_REFUSED", "The AI service declined to read this file.");
        if (body.stop_reason === "max_tokens") throw extractError("INVOICE_LLM_TRUNCATED", "The AI answer was cut off (invoice too long).");
        return {
          text: (body.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""),
          usage: { model: body.model ?? model, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
        };
      }
    },
  };
}

// ---- queue: at most CONCURRENCY model calls at a time ----
let active = 0;
const waiting = [];
async function queued(task) {
  if (active >= CONCURRENCY) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// Sarvam: one job at a time (10 requests/minute per key, polls included).
let sarvamChain = Promise.resolve();
function queuedSarvam(task) {
  const run = sarvamChain.then(task, task);
  sarvamChain = run.catch(() => {});
  return run;
}

function parseJsonReply(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "The reply contains no JSON object." };
  try {
    return { value: JSON.parse(text.slice(start, end + 1)) };
  } catch (error) {
    return { error: `The reply is not valid JSON: ${error.message}` };
  }
}

// Build the user message for one invoice: text layer (digital PDF) or page images.
async function contentFor(prepared, fileName) {
  if (prepared.kind === "text") {
    return [{ type: "text", text: `Invoice file "${fileName}" (text layer of a digital PDF, ${prepared.pageCount} page(s)):\n\n${prepared.text}\n\nTranscribe it.` }];
  }
  return [
    ...prepared.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: Buffer.from(image.data).toString("base64") } })),
    { type: "text", text: `Invoice file "${fileName}": ${prepared.images.length} page image(s) in order. Transcribe it.` },
  ];
}

// file: { name, buffer } (an upload) or { name, path }. Returns the normalized InvoiceJSON.
async function extractInvoice(file, options = {}) {
  return (await extractInvoiceDetailed(file, options)).invoice;
}

// Which reader: INVOICE_PROVIDER = claude | sarvam | sarvam_then_claude; unset -> whichever key is set
// (Claude if both). Both keys are optional: without one, the converter runs in demo mode.
function chosenProvider() {
  const wanted = process.env.INVOICE_PROVIDER;
  if (["claude", "sarvam", "sarvam_then_claude"].includes(wanted)) return wanted;
  if (process.env.INVOICE_LLM_API_KEY) return "claude";
  return process.env.SARVAM_API_KEY ? "sarvam" : "claude";
}

function providerConfigured(name = chosenProvider()) {
  if (name === "claude") return Boolean(process.env.INVOICE_LLM_API_KEY);
  if (name === "sarvam") return Boolean(process.env.SARVAM_API_KEY);
  return Boolean(process.env.SARVAM_API_KEY && process.env.INVOICE_LLM_API_KEY);
}

// -> { invoice, meta: { provider, pages?, usage?, fallback?, fallbackReason?, fallbackError? } }
async function extractInvoiceDetailed(file, { provider, sarvam, providerName = provider ? "claude" : chosenProvider(), rotate = 0 } = {}) {
  if (providerName === "sarvam") return readWithSarvam(file, { sarvam, rotate });
  if (providerName === "claude") return readWithClaude(file, { provider, rotate });
  // sarvam_then_claude: Sarvam first; Claude only when the checks fail or a field is low-confidence.
  const first = await readWithSarvam(file, { sarvam, rotate }).catch((error) => ({ error }));
  let why = null;
  if (first.error) why = "Sarvam failed (" + (first.error.code ?? "error") + ")";
  else if (validateInvoice(first.invoice).status === "NEEDS REVIEW") why = "checks failed on the Sarvam reading";
  else if (Object.values(first.invoice.confidence ?? {}).includes("low")) why = "Sarvam marked fields low-confidence";
  if (!why) return first;
  try {
    const second = await readWithClaude(file, { provider, rotate });
    return { invoice: second.invoice, meta: { ...second.meta, fallback: true, fallbackReason: why, sarvamPages: first.meta?.pages ?? null } };
  } catch (error) {
    if (first.error) throw first.error;
    return { invoice: first.invoice, meta: { ...first.meta, fallbackReason: why, fallbackError: error.code ?? error.message } };
  }
}

async function withLocalFile(file, work) {
  if (file.path) return work(file.path);
  const path = join(tmpdir(), "invoice-" + randomUUID());
  await writeFile(path, file.buffer);
  try {
    return await work(path);
  } finally {
    await rm(path, { force: true });
  }
}

async function readWithSarvam(file, { sarvam = sarvamProvider(), rotate = 0 }) {
  return withLocalFile(file, async (path) => {
    // PDFs go as they are (Sarvam reads text layers and scans, max 10 pages); photos go as the
    // prepared JPEG (EXIF/rotate applied, downscaled, HEIC converted: Sarvam takes PDF, JPG, PNG).
    const buffer = file.buffer ?? (await readFile(path));
    let upload = { name: file.name, buffer, mediaType: "application/pdf" };
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-" || rotate) {
      const prepared = await prepareInvoiceFile(path, { rotate });
      if (prepared.kind !== "images") throw extractError("INVOICE_UNSUPPORTED_FILE", "Unsupported file for Sarvam.");
      if (prepared.images.length > 1) throw extractError("SARVAM_MULTIPAGE", "Rotated multi-page PDFs are not supported with Sarvam yet.");
      upload = { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", buffer: Buffer.from(prepared.images[0].data), mediaType: "image/jpeg" };
    }
    const read = await queuedSarvam(() => sarvam.extract(upload));
    const checked = validateInvoiceJson(read.invoice);
    if (!checked.ok) throw extractError("INVOICE_SARVAM_BAD_JSON", "Sarvam's result did not match the invoice format (" + checked.errors.slice(0, 3).join("; ") + ").");
    // Sarvam scores empty fields too; only a value that was actually read can be doubtful.
    const value = (path) => path.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), checked.invoice);
    checked.invoice.confidence = Object.fromEntries(Object.entries(checked.invoice.confidence).filter(([path]) => value(path) != null && value(path) !== ""));
    return { invoice: checked.invoice, meta: { provider: "sarvam", pages: read.pages, partial: read.partial } };
  });
}

async function readWithClaude(file, { provider = claudeProvider(), rotate = 0 }) {
  let path = file.path;
  let cleanup = null;
  if (!path) {
    path = join(tmpdir(), `invoice-${randomUUID()}`);
    await writeFile(path, file.buffer);
    cleanup = () => rm(path, { force: true });
  }
  try {
    const prepared = await prepareInvoiceFile(path, { rotate });
    const messages = [{ role: "user", content: await contentFor(prepared, file.name) }];
    const usage = { model: null, inputTokens: 0, outputTokens: 0, calls: 0 };
    return await queued(async () => {
      // One retry when the reply isn't schema-valid JSON, telling the model what was wrong.
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await provider.complete({ system: SYSTEM_PROMPT, messages });
        const reply = typeof answer === "string" ? answer : answer.text;
        if (answer?.usage) {
          usage.model = answer.usage.model;
          usage.inputTokens += answer.usage.inputTokens;
          usage.outputTokens += answer.usage.outputTokens;
        }
        usage.calls++;
        const parsed = parseJsonReply(reply);
        const checked = parsed.error ? { ok: false, errors: [parsed.error] } : validateInvoiceJson(parsed.value);
        if (checked.ok) return { invoice: checked.invoice, meta: { provider: "claude", usage } };
        if (attempt === 1) throw extractError("INVOICE_LLM_BAD_JSON", `The AI reply did not match the invoice format twice (${checked.errors.slice(0, 3).join("; ")}).`);
        messages.push({ role: "assistant", content: reply });
        messages.push({ role: "user", content: `That JSON is not valid for the required shape: ${checked.errors.slice(0, 10).join("; ")}. Return the complete corrected JSON object only.` });
      }
    });
  } finally {
    await cleanup?.();
  }
}

export { chosenProvider, claudeProvider, extractInvoice, extractInvoiceDetailed, providerConfigured, SYSTEM_PROMPT };
