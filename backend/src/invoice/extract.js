// AI reading of invoices: extractInvoice(file) -> InvoiceJSON. The model only transcribes; every
// figure is re-checked in validate.js. The provider is swappable (tests use a mock); the default is
// Claude over the Messages API with plain fetch. Nothing here logs invoice contents.
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { prepareInvoiceFile } from "./images.js";
import { readFile } from "node:fs/promises";
import { INVOICE_SCHEMA, validateInvoiceJson } from "./schema.js";
import { sarvamProvider } from "./sarvam.js";
import { geminiProvider, logUsage } from "./gemini.js";
import { validateInvoice } from "./validate.js";
import { applyReadingRules, hsnFromRawLine, validHsn } from "./rules.js";
import { learnFrom, loadDictionary } from "./hsnDictionary.js";

// Provider-independent clean-up (rules.js) of a schema-valid reading.
const withRules = (invoice) => {
  const { invoice: ruled, derived } = applyReadingRules(invoice);
  ruled.derived = derived;
  return ruled;
};

// Double-check: important fields (same set as the "please check" notes) where two readings differ.
// -> [{ field, gemini, sarvam }], values as text (null = blank).
const CROSS_FIELDS = ["supplier.gstin", "buyer.gstin", "invoiceNo", "invoiceDate", "totals.taxableAmount", "totals.cgst", "totals.sgst", "totals.igst", "totals.roundOff", "totals.grandTotal", "payment.amount", "payment.reference", "payment.date"];
const CROSS_LINE_FIELDS = ["qty", "rate", "amount", "hsnSac", "gstRate"];
function crossCheck(gemini, sarvam) {
  const get = (obj, path) => path.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj) ?? null;
  const norm = (v) => (v === null || v === "" ? null : typeof v === "number" ? Math.round(v * 100) : String(v).replace(/[\s.,/-]+/g, "").toUpperCase());
  const lines = Math.max(gemini.lineItems?.length ?? 0, sarvam.lineItems?.length ?? 0);
  const paths = [...CROSS_FIELDS, ...Array.from({ length: lines }, (_, i) => CROSS_LINE_FIELDS.map((f) => `lineItems[${i}].${f}`)).flat()];
  return paths
    .map((field) => ({ field, gemini: get(gemini, field), sarvam: get(sarvam, field) }))
    .filter((d) => norm(d.gemini) !== norm(d.sarvam))
    .map((d) => ({ field: d.field, gemini: d.gemini === null ? null : String(d.gemini), sarvam: d.sarvam === null ? null : String(d.sarvam) }));
}

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
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !["derived", "useComputedTotals", "crossCheck", "hsnNote"].includes(key)).map(([key, value]) => [key, skeleton(value)]));
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
- rawLine: for every line item, the exact text of that printed or handwritten line as read, left to right, with all its numbers (e.g. "68 sf Film 3920 55/- 3,740/-"). Copy only what is written.
- hsnSac: on handwritten bill-book rows with no column headings, the layout is "qty+item  HSN  rate  amount" (e.g. "68 sf Film   3920  55/-  3,740/-"). The 4 to 8 digit whole number between the item and the rate (3918, 3920, 6303, 6503, 9403...) is the HSN, never the qty or rate. Always fill it when such a number is written; null only if none is.
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
    async complete({ system, messages, signal = AbortSignal.timeout(TIMEOUT_MS) }) {
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
            signal,
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

// ---- queues: at most `limit` model calls at a time per service ----
function makeQueue(limit) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const queued = makeQueue(CONCURRENCY);
// Gemini: 3 files in parallel by default; 429s wait as Gemini says (gemini.js).
const queuedGemini = makeQueue(Number(process.env.GEMINI_CONCURRENCY) || 3);

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

// Which reader: INVOICE_PROVIDER = gemini (default) | claude | sarvam | sarvam_then_claude. Keys are
// optional: without the chosen provider's key, the converter runs in demo mode.
// Sarvam is used only when INVOICE_PROVIDER names it explicitly: a SARVAM_API_KEY alone never sends
// invoices there.
function chosenProvider() {
  const wanted = process.env.INVOICE_PROVIDER;
  return ["claude", "gemini", "sarvam", "sarvam_then_claude"].includes(wanted) ? wanted : "gemini";
}

// Data terms confirmed by the user: Gemini key is billing-enabled; Sarvam DPA + zero retention.
const geminiConfirmed = () => process.env.GEMINI_BILLING_CONFIRMED === "true";
const sarvamConfirmed = () => process.env.SARVAM_DPA_CONFIRMED === "true";

// "Double-check handwritten bills": Gemini + Sarvam on every photo/scan. Only with both confirmed.
function doubleCheckAllowed() {
  return chosenProvider() === "gemini" && providerConfigured("gemini") && providerConfigured("sarvam") && geminiConfirmed() && sarvamConfirmed();
}

// What the pages show: which service reads invoices and where the data goes.
function providerInfo() {
  const provider = chosenProvider();
  const configured = providerConfigured(provider);
  const usesSarvam = provider.startsWith("sarvam");
  const testingOnly = configured && (usesSarvam ? !sarvamConfirmed() : provider === "gemini" && !geminiConfirmed());
  const where = {
    claude: "Anthropic (Claude API)",
    gemini: "Google (Gemini API)",
    sarvam: "Sarvam AI (Document Intelligence)",
    sarvam_then_claude: "Sarvam AI first, then Anthropic (Claude API) when Sarvam's reading fails the checks",
  }[provider];
  const notes = [];
  if (!configured) notes.push("Demo mode: no invoice is sent to an AI service.");
  else notes.push(`Invoice images and PDF text are sent to ${where} for reading.`);
  if (configured && provider === "gemini") {
    notes.push("With a billing-enabled key, Google does not use prompts or responses to improve its products; it logs them for a limited period only to detect misuse.");
    if (testingOnly) notes.push("Testing only: the Gemini key is not confirmed as billing-enabled yet (free-tier data is used by Google). Do not use for client invoices.");
  }
  if (configured && usesSarvam) {
    notes.push("Sarvam says it processes data on Microsoft Azure, Central India, and keeps inputs and outputs 30 days after last access unless retention is set to zero.");
    if (testingOnly) notes.push("Testing only: Sarvam's DPA and zero-retention setting are not confirmed yet. Do not use for client invoices.");
  }
  return { provider, configured, testingOnly, where: configured ? where : null, notes, doubleCheckAllowed: doubleCheckAllowed() };
}

function providerConfigured(name = chosenProvider()) {
  if (name === "claude") return Boolean(process.env.INVOICE_LLM_API_KEY);
  if (name === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (name === "sarvam") return Boolean(process.env.SARVAM_API_KEY);
  return Boolean(process.env.SARVAM_API_KEY && process.env.INVOICE_LLM_API_KEY);
}

// -> { invoice, meta: { provider, pages?, usage?, fallback?, fallbackReason?, fallbackError? } }
// doubleCheck (Gemini only, when doubleCheckAllowed()): photos/scans are also read by Sarvam, and
// every important field the two read differently becomes a "please check" note with both values.
async function extractInvoiceDetailed(file, { provider, sarvam, providerName = provider ? "claude" : chosenProvider(), rotate = 0, doubleCheck = false } = {}) {
  if (providerName === "sarvam") return readWithSarvam(file, { sarvam, rotate });
  if (providerName === "claude") return readWithClaude(file, { provider, rotate });
  // Gemini: same prompt, schema check + retry, rules and checks as Claude.
  if (providerName === "gemini") {
    // GEMINI_MODEL_INVOICE: the invoice model; unset = GEMINI_MODEL, else the default model.
    const read = await readWithClaude(file, { provider: provider ?? geminiProvider({ model: process.env.GEMINI_MODEL_INVOICE || undefined }), rotate, queue: queuedGemini });
    if (!provider && read.meta.usage?.model) logUsage("Gemini run (invoice)", [read.meta.usage]);
    if (!doubleCheck || read.meta.kind !== "images" || !(sarvam || doubleCheckAllowed())) return read;
    const second = await readWithSarvam(file, { sarvam, rotate }).catch((error) => ({ error }));
    if (second.error) {
      read.invoice.derived.push("Double-check skipped: Sarvam could not read this file.");
      return { ...read, meta: { ...read.meta, doubleCheck: { error: second.error.code ?? "error" } } };
    }
    read.invoice.crossCheck = crossCheck(read.invoice, second.invoice);
    return { ...read, meta: { ...read.meta, doubleCheck: { sarvamPages: second.meta.pages, disagreements: read.invoice.crossCheck.length } } };
  }
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
    return { invoice: withRules(checked.invoice), meta: { provider: "sarvam", pages: read.pages, partial: read.partial } };
  });
}

// ---- raw reading (debug) and the targeted HSN re-read ----
// Every provider answer is saved (git-ignored tmp/invoice-debug) so a wrong or empty field can be traced to what the
// model actually returned. INVOICE_DEBUG_RAW=off disables it; tests never write it.
async function saveRawReading(fileName, value) {
  if (process.env.INVOICE_DEBUG_RAW === "off" || process.env.NODE_TEST_CONTEXT) return;
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tmp", "invoice-debug");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${String(fileName).replace(/[^w.-]+/g, "_")}.json`), JSON.stringify({ file: fileName, reading: value }, null, 2));
  } catch {
    // a debug copy must never fail a reading
  }
}

const has = (n) => typeof n === "number" && Number.isFinite(n);
// Lines still without HSN after the rules, when the page probably does show one: another line has one, or a
// number that looks like an HSN sits in the line's own text.
function linesNeedingHsn(invoice) {
  const lines = invoice.lineItems ?? [];
  const anyHsn = lines.some((line) => line.hsnSac);
  return lines.flatMap((line, index) => {
    if (line.hsnSac || !line.description) return [];
    const looksHsn = (String(line.rawLine ?? "").replace(/,/g, "").match(/\b\d{4,8}\b/g) ?? []).some((n) => validHsn(n) && ![line.qty, line.rate, line.amount].includes(Number(n)));
    return anyHsn || looksHsn ? [index] : [];
  });
}

const HSN_ASK_SCHEMA = { type: "object", properties: { lines: { type: "array", items: { type: "object", properties: { line: { type: "integer" }, rawLine: { type: "string", nullable: true }, hsn: { type: "string", nullable: true }, rate: { type: "number", nullable: true }, amount: { type: "number", nullable: true } }, required: ["line", "rawLine", "hsn", "rate", "amount"] } } }, required: ["lines"] };

// ONE extra call per page. The answer is not trusted as is: its rawLine goes through the same arithmetic check as
// rule a) (hsnFromRawLine). Mutates the invoice; -> number of lines filled.
async function rereadHsn(provider, invoice, content, signal, usage) {
  const wanted = linesNeedingHsn(invoice);
  if (!wanted.length) return 0;
  const list = wanted.map((i) => `Line ${i + 1}: ${invoice.lineItems[i].description}`).join("\n");
  const ask = [...content, { type: "text", text: `For each of these lines of the invoice above, return what is WRITTEN on that line: rawLine (its exact text left to right, all numbers), hsn (the 4, 6 or 8 digit HSN/SAC written on the line, else null), rate and amount as written. Copy only; never calculate.\n${list}` }];
  const answer = await provider.complete({ system: "You transcribe one line at a time from an invoice image. Return JSON only.", messages: [{ role: "user", content: ask }], signal, responseSchema: HSN_ASK_SCHEMA });
  usage.calls++;
  if (answer?.usage) (usage.inputTokens += answer.usage.inputTokens, (usage.outputTokens += answer.usage.outputTokens));
  const parsed = parseJsonReply(typeof answer === "string" ? answer : answer.text);
  let filled = 0;
  for (const item of parsed.value?.lines ?? []) {
    const line = invoice.lineItems[(item.line ?? 0) - 1];
    if (!line || line.hsnSac || !wanted.includes(item.line - 1)) continue;
    const probe = { ...line, rawLine: item.rawLine, rate: has(line.rate) ? line.rate : null, amount: has(line.amount) ? line.amount : has(item.amount) ? item.amount : null };
    const hit = hsnFromRawLine(probe, invoice);
    if (!hit) continue;
    line.hsnSac = hit.hsn;
    line.rawLine = item.rawLine;
    if (!has(line.rate)) line.rate = hit.rate;
    if (!has(line.qty) && has(line.amount) && line.rate > 0) line.qty = Math.round((line.amount / line.rate) * 100) / 100;
    line.hsnNote = `HSN ${hit.hsn} found by reading line ${item.line} again, not in the first reading`;
    invoice.derived.push(`Line ${line.sno ?? item.line}: ${line.hsnNote}.`);
    filled++;
  }
  return filled;
}

async function readWithClaude(file, { provider = claudeProvider(), rotate = 0, queue = queued }) {
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
    return await queue(async () => {
      // One deadline per file, from when its turn in the queue starts (covers retries).
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      // One retry when the reply isn't schema-valid JSON, telling the model what was wrong.
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await provider.complete({ system: SYSTEM_PROMPT, messages, signal });
        const reply = typeof answer === "string" ? answer : answer.text;
        if (answer?.usage) {
          usage.model = answer.usage.model;
          usage.inputTokens += answer.usage.inputTokens;
          usage.outputTokens += answer.usage.outputTokens;
        }
        usage.calls++;
        const parsed = parseJsonReply(reply);
        const checked = parsed.error ? { ok: false, errors: [parsed.error] } : validateInvoiceJson(parsed.value);
        if (checked.ok) {
          await saveRawReading(file.name, parsed.value);
          const invoice = withRules(checked.invoice);
          // Only the model providers can be asked again; one targeted call, only when HSN gaps remain.
          let reread = 0;
          if (provider.name && prepared.kind === "images" && process.env.INVOICE_HSN_REREAD !== "off") {
            reread = await rereadHsn(provider, invoice, messages[0].content, signal, usage).catch(() => 0);
          }
          return { invoice, meta: { provider: provider.name?.split(":")[0] ?? "claude", usage, kind: prepared.kind, hsnReread: reread } };
        }
        if (attempt === 1) throw extractError("INVOICE_LLM_BAD_JSON", `The AI reply did not match the invoice format twice (${checked.errors.slice(0, 3).join("; ")}).`);
        messages.push({ role: "assistant", content: reply });
        messages.push({ role: "user", content: `That JSON is not valid for the required shape: ${checked.errors.slice(0, 10).join("; ")}. Return the complete corrected JSON object only.` });
      }
    });
  } finally {
    await cleanup?.();
  }
}

export { chosenProvider, claudeProvider, crossCheck, doubleCheckAllowed, extractInvoice, extractInvoiceDetailed, providerConfigured, providerInfo, SYSTEM_PROMPT };
