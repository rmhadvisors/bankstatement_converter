// HTTP handlers for the invoice converter. Same shape as the bank/card routes: uploads are saved to
// temp files, processed as a background job polled by id, and deleted when done. Logs carry only
// error codes, never invoice contents.
import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInvoiceJson } from "./schema.js";
import { validateBatch } from "./validate.js";
import { ENTRY_TYPES, guessEntryType, matchParty } from "./parties.js";
import { buildTallyWorkbookBuffer } from "./tallyWorkbook.js";
import { sniffType } from "./images.js";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;
const DEMO_DIR = process.env.INVOICE_DEMO_DIR || join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "tests", "fixtures", "invoices");

const jobs = new Map();
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const json = (body, status = 200) => Response.json(body, { status });
const invoiceError = (code, message, status = 400) => json({ code, message }, status);

// Set by Stage 3 (AI extraction). Until then, or without an API key, the page runs in demo mode.
let extractor = null;
function setInvoiceExtractor(fn) {
  extractor = fn;
}
const mode = () => (extractor && process.env.INVOICE_LLM_API_KEY ? "live" : "demo");

// Demo mode: the hand-typed JSON for the client's sample invoices, matched by file content hash.
let demoSamples = null;
async function loadDemoSamples() {
  if (demoSamples) return demoSamples;
  demoSamples = new Map();
  const names = await readdir(join(DEMO_DIR, "demo")).catch(() => []);
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const sample = JSON.parse(await readFile(join(DEMO_DIR, "demo", name), "utf8"));
    if (typeof sample.file !== "string") continue; // parties.json, expected.json
    const source = await readFile(join(DEMO_DIR, sample.file)).catch(() => null);
    if (source) demoSamples.set(sha256(source), sample);
  }
  return demoSamples;
}

async function bufferOf(file) {
  return Buffer.from(await file.arrayBuffer());
}

async function handleInvoiceConvertSubmit(request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((file) => file instanceof File);
  if (!files.length) return invoiceError("NO_FILES", "Choose at least one invoice file.");
  if (files.length > MAX_FILES) return invoiceError("TOO_MANY_FILES", `Upload at most ${MAX_FILES} files at a time.`);

  const uploads = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) return invoiceError("FILE_TOO_LARGE", `${file.name} is larger than 20 MB.`);
    const buffer = await bufferOf(file);
    if (!sniffType(buffer)) return invoiceError("INVOICE_UNSUPPORTED_FILE", `${file.name} is not a JPG, PNG, WEBP, HEIC or PDF file.`);
    uploads.push({ name: file.name, buffer });
  }

  const id = crypto.randomUUID();
  const job = { mode: mode(), files: uploads.map((upload) => ({ name: upload.name, state: "queued" })), expiresAt: Date.now() + JOB_TTL_MS };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  runInvoiceJob(job, uploads); // background; failures are recorded per file
  return json({ jobId: id, mode: job.mode }, 202);
}

async function runInvoiceJob(job, uploads) {
  const samples = job.mode === "demo" ? await loadDemoSamples() : null;
  for (const [index, upload] of uploads.entries()) {
    const file = job.files[index];
    file.state = "reading";
    try {
      if (job.mode === "demo") {
        const sample = samples.get(sha256(upload.buffer));
        if (!sample) throw Object.assign(new Error("Demo mode only reads the 4 sample invoices. AI reading is not connected yet."), { code: "NOT_A_DEMO_SAMPLE" });
        file.invoice = validateInvoiceJson(sample.invoice).invoice;
      } else {
        file.invoice = await extractor(upload);
      }
      file.state = "done";
    } catch (error) {
      file.state = "error";
      file.error = { code: error.code || "INVOICE_READ_FAILED", message: error.message || "Could not read this invoice." };
      console.warn(`/api/invoice/convert file failed: ${file.error.code}`);
    } finally {
      upload.buffer = null; // nothing of the upload outlives its processing
    }
  }
}

function handleInvoiceStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return invoiceError("JOB_NOT_FOUND", "Unknown or expired invoice job.", 404);
  const pending = job.files.some((file) => file.state === "queued" || file.state === "reading");
  return json({ status: pending ? "processing" : "done", mode: job.mode, files: job.files }, pending ? 202 : 200);
}

// items: [{ invoice, sourceFile, entryType? }] -> validation + party/entry type per invoice.
function evaluate(items, { parties = [], financialYear = null, history = [] } = {}) {
  const normalized = items.map((item) => ({ ...item, invoice: validateInvoiceJson(item.invoice ?? {}).invoice }));
  const results = validateBatch(normalized, { financialYear, history });
  return normalized.map((item, i) => {
    const match = matchParty(item.invoice.supplier, parties);
    const chosen = ENTRY_TYPES.includes(item.entryType) ? item.entryType : null;
    const guess = guessEntryType(item.invoice);
    const party = match
      ? { name: match.party.name, entryType: match.party.entryType, source: "settings", matchedBy: match.matchedBy }
      : { name: String(item.invoice.supplier?.name ?? "").toUpperCase(), entryType: chosen ?? guess.entryType, source: chosen ? "chosen" : "guess", guessReason: guess.reason };
    return { invoice: item.invoice, sourceFile: item.sourceFile ?? null, result: results[i], party };
  });
}

async function handleInvoiceValidate(request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.items)) return invoiceError("BAD_REQUEST", "Expected { items: [...] }.");
  const evaluated = evaluate(body.items, body);
  return json({ results: evaluated.map(({ result, party, invoice }) => ({ ...result, party, invoice })) });
}

async function handleInvoiceExport(request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.items) || !body.items.length) return invoiceError("BAD_REQUEST", "Nothing to export.");
  const evaluated = evaluate(body.items, body);
  const unconfirmed = evaluated.filter((entry) => entry.party.source === "guess");
  if (unconfirmed.length) {
    return invoiceError("ENTRY_TYPE_NEEDED", `Choose the Tally entry type for: ${[...new Set(unconfirmed.map((e) => e.party.name))].join(", ")}.`, 422);
  }
  const entries = evaluated.map((entry) => ({ ...entry, entryType: entry.party.entryType, partyName: entry.party.name }));
  const buffer = await buildTallyWorkbookBuffer(entries, body.parties ?? []);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Invoices_Tally.xlsx"`,
    },
  });
}

// Demo/dev only: a starter party list from the git-ignored demo folder (no client names in code).
async function loadDemoParties() {
  return JSON.parse(await readFile(join(DEMO_DIR, "demo", "parties.json"), "utf8").catch(() => "[]"));
}

async function handleInvoiceConfig() {
  return json({ mode: mode(), defaultParties: await loadDemoParties(), entryTypes: ENTRY_TYPES });
}

export { evaluate, handleInvoiceConfig, handleInvoiceConvertSubmit, handleInvoiceExport, handleInvoiceStatus, handleInvoiceValidate, setInvoiceExtractor };
