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
import { buildInvoiceSheetBuffer } from "./tallyWorkbook.js";
import { sniffType, splitBillBook } from "./images.js";
import { doubleCheckAllowed, extractInvoice, providerConfigured, providerInfo } from "./extract.js";

const MAX_FILES = 20;
const MAX_PAGES = 60; // after a bill-book PDF is split into one upload per page
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;
const DEMO_DIR = process.env.INVOICE_DEMO_DIR || join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "tests", "fixtures", "invoices");

const jobs = new Map();
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const json = (body, status = 200) => Response.json(body, { status });
const invoiceError = (code, message, status = 400) => json({ code, message }, status);

// AI reading (extract.js). Without the chosen provider's key the page runs in demo mode instead;
// tests can swap the extractor for a mock.
let extractor = (upload, options) => extractInvoice(upload, options);
function setInvoiceExtractor(fn) {
  extractor = fn;
}
const mode = () => (extractor && providerConfigured() ? "live" : "demo");

// Demo mode: the hand-typed JSON for the client's sample invoices, matched by file content hash.
let demoSamples = null;
async function loadDemoSamples() {
  if (demoSamples) return demoSamples;
  demoSamples = new Map();
  const names = await readdir(join(DEMO_DIR, "demo")).catch(() => []);
  // Hand-typed samples only (name.json); recorded AI readings (name.<provider>.live.json) are not demo data.
  for (const name of names.filter((n) => /^[^.]+\.json$/.test(n))) {
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
    const pages = sniffType(buffer) === "pdf" ? await splitBillBook(buffer).catch(() => null) : null;
    if (pages) pages.forEach((page, i) => uploads.push({ name: `${file.name} (page ${i + 1})`, buffer: page, book: file.name }));
    else uploads.push({ name: file.name, buffer });
  }

  // "Double-check handwritten bills" (settings page): honoured only when both providers are confirmed.
  if (uploads.length > MAX_PAGES) return invoiceError("TOO_MANY_FILES", `At most ${MAX_PAGES} invoices (files or PDF pages) at a time.`);
  const doubleCheck = form.get("doubleCheck") === "true" && doubleCheckAllowed();
  const id = crypto.randomUUID();
  const job = { mode: mode(), doubleCheck, files: uploads.map((upload) => ({ name: upload.name, state: "queued" })), expiresAt: Date.now() + JOB_TTL_MS };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  runInvoiceJob(job, uploads); // background; failures are recorded per file
  return json({ jobId: id, mode: job.mode }, 202);
}

// Files are read in parallel; each provider's queue in extract.js limits how many calls run at once.
async function runInvoiceJob(job, uploads) {
  const samples = job.mode === "demo" ? await loadDemoSamples() : null;
  await Promise.all(uploads.map(async (upload, index) => {
    const file = job.files[index];
    file.state = "reading";
    try {
      if (job.mode === "demo") {
        const sample = samples.get(sha256(upload.buffer));
        if (!sample) throw Object.assign(new Error("Demo mode only reads the 4 sample invoices. AI reading is not connected yet."), { code: "NOT_A_DEMO_SAMPLE" });
        file.invoice = validateInvoiceJson(sample.invoice).invoice;
      } else {
        file.invoice = await extractor(upload, { doubleCheck: job.doubleCheck });
      }
      file.state = "done";
    } catch (error) {
      file.state = "error";
      file.error = { code: error.code || "INVOICE_READ_FAILED", message: error.message || "Could not read this invoice." };
      console.warn(`/api/invoice/convert file failed: ${file.error.code}`);
    } finally {
      upload.buffer = null; // nothing of the upload outlives its processing
    }
  }));
  for (const book of new Set(uploads.map((upload) => upload.book).filter(Boolean))) {
    shareBookSeller(job.files.filter((_, i) => uploads[i].book === book).map((file) => file.invoice).filter(Boolean));
  }
}

// A bill book (one PDF of many bills) is one seller's. Handwritten bills carry only the customer at the top, so
// the model reads that customer as the supplier. The seller is taken from the bills that print both parties
// (a printed tax invoice); on every bill that lacks a buyer, the written name becomes the buyer and the seller
// is filled in. Mutates the invoices. Does nothing when no bill in the book shows the seller.
function shareBookSeller(invoices) {
  const key = (party) => String(party?.gstin || party?.name || "").toUpperCase().replace(/\s+/g, "");
  const counts = new Map();
  for (const { supplier, buyer } of invoices) {
    if (supplier?.name && buyer?.name) counts.set(key(supplier), { party: supplier, n: (counts.get(key(supplier))?.n ?? 0) + 1 });
  }
  const seller = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.party;
  if (!seller) return;
  for (const invoice of invoices) {
    if (key(invoice.supplier) === key(seller) || invoice.buyer?.name || !invoice.supplier?.name) continue;
    const { name, gstin, address } = invoice.supplier;
    invoice.buyer = { ...invoice.buyer, name, gstin: gstin ?? null, address: address ?? null };
    invoice.supplier = { ...seller };
    (invoice.derived ??= []).push("Bill book: the written name is the buyer; the seller is taken from the printed bill in the same PDF.");
  }
}

function handleInvoiceStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return invoiceError("JOB_NOT_FOUND", "Unknown or expired invoice job.", 404);
  const pending = job.files.some((file) => file.state === "queued" || file.state === "reading");
  return json({ status: pending ? "processing" : "done", mode: job.mode, files: job.files }, pending ? 202 : 200);
}

// items: [{ invoice, sourceFile, entryType? }] -> validation + party/entry type per invoice.
function evaluate(items, { parties = [], financialYear = null, history = [], salesMode = process.env.INVOICE_PARTY_SIDE === "buyer" } = {}) {
  const normalized = items.map((item) => ({ ...item, invoice: validateInvoiceJson(item.invoice ?? {}).invoice }));
  const results = validateBatch(normalized, { financialYear, history });
  return normalized.map((item, i) => {
    // Sales invoices (issued by the user's client): the party is the customer, not the biller.
    const counterparty = salesMode ? item.invoice.buyer : item.invoice.supplier;
    const match = matchParty(counterparty, parties);
    const chosen = ENTRY_TYPES.includes(item.entryType) ? item.entryType : null;
    const guess = guessEntryType({ ...item.invoice, supplier: counterparty });
    const party = match
      ? { name: match.party.name, entryType: match.party.entryType, source: "settings", matchedBy: match.matchedBy }
      : { name: String(counterparty?.name ?? "").toUpperCase(), entryType: chosen ?? guess.entryType, source: chosen ? "chosen" : "guess", guessReason: guess.reason };
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
  const failed = (Array.isArray(body?.failed) ? body.failed : []).map((f) => ({ sourceFile: String(f?.sourceFile ?? "").slice(0, 200), message: String(f?.message ?? "Could not be read.").slice(0, 500) }));
  if (!Array.isArray(body?.items) || (!body.items.length && !failed.length)) return invoiceError("BAD_REQUEST", "Nothing to export.");
  const evaluated = evaluate(body.items, body);
  // A party without a saved entry type uses the suggested one (guessEntryType); the user can still override it.
  const entries = evaluated.map((entry) => ({ ...entry, entryType: entry.party.entryType, partyName: entry.party.name, salesMode: process.env.INVOICE_PARTY_SIDE === "buyer" }));
  const buffer = await buildInvoiceSheetBuffer(entries, { failed });
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
  return json({ mode: mode(), provider: providerInfo(), defaultParties: await loadDemoParties(), entryTypes: ENTRY_TYPES });
}

export { shareBookSeller, evaluate, handleInvoiceConfig, handleInvoiceConvertSubmit, handleInvoiceExport, handleInvoiceStatus, handleInvoiceValidate, setInvoiceExtractor };
