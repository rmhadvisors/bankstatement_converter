// HTTP handlers for the fuel sales register converter (fuelRegister.js, fuelWorkbook.js). Same shape
// as the invoice routes: the upload is read as a background job polled by id; the page images stay in
// memory for the review screen until the job expires. Logs carry only counts and error codes.
import crypto from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FUEL_PARTIES, buildFuelRegister, mergeReads, readFuelRegister } from "./fuelRegister.js";
import { buildFuelWorkbookBuffer } from "./fuelWorkbook.js";
import { sniffType } from "./images.js";
import { providerConfigured } from "./extract.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;
const jobs = new Map();
const json = (body, status = 200) => Response.json(body, { status });
const fuelError = (code, message, status = 400) => json({ code, message }, status);

// Tests swap the reader for a saved reading (no live Gemini calls).
const defaultReader = (file) => readFuelRegister(file);
let reader = defaultReader;
function setFuelReader(fn) {
  reader = fn;
}

async function handleFuelConvertSubmit(request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fuelError("NO_FILES", "Choose the register PDF.");
  if (file.size > MAX_FILE_BYTES) return fuelError("FILE_TOO_LARGE", `${file.name} is larger than 20 MB.`);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (sniffType(buffer) !== "pdf") return fuelError("FUEL_REGISTER_NOT_PDF", "The fuel sales register must be a PDF.");
  if (reader === defaultReader && !providerConfigured("gemini")) return fuelError("GEMINI_KEY_MISSING", "Gemini is not configured (GEMINI_API_KEY is not set).", 503);

  const id = crypto.randomUUID();
  const job = { state: "reading", name: file.name, expiresAt: Date.now() + JOB_TTL_MS };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  runFuelJob(job, buffer); // background; a failure is recorded on the job
  return json({ jobId: id }, 202);
}

async function runFuelJob(job, buffer) {
  const path = join(tmpdir(), `fuel-${crypto.randomUUID()}.pdf`);
  try {
    await writeFile(path, buffer);
    const { reading, images, calls } = await reader({ path });
    job.reading = { pages: mergeReads(reading) };
    job.images = images;
    job.calls = calls;
    job.state = "done";
    console.log(`/api/fuel-register/convert: Gemini calls ${calls.total} (${calls.first} first readings, ${calls.second} second readings)`);
  } catch (error) {
    job.state = "error";
    job.error = { code: error.code || "FUEL_REGISTER_READ_FAILED", message: error.message || "Could not read the register." };
    console.warn(`/api/fuel-register/convert failed: ${job.error.code}`);
  } finally {
    await rm(path, { force: true });
  }
}

function handleFuelStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return fuelError("JOB_NOT_FOUND", "Unknown or expired register job.", 404);
  if (job.state === "reading") return json({ status: "processing" }, 202);
  if (job.state === "error") return json({ status: "error", error: job.error });
  return json({ status: "done", pageCount: job.images.length, calls: job.calls, reading: job.reading });
}

function handleFuelPage(jobId, page) {
  const image = jobs.get(jobId)?.images?.[Number(page) - 1];
  if (!image) return fuelError("PAGE_NOT_FOUND", "Unknown page.", 404);
  return new Response(Buffer.from(image.data), { headers: { "Content-Type": image.mediaType, "Cache-Control": "private, max-age=1800" } });
}

// Trust boundary: the review screen sends the reading back with edits; take only the known fields.
const finite = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);
function cleanOptions(body) {
  if (!Array.isArray(body?.reading?.pages)) throw Object.assign(new Error("Expected { reading: { pages: [...] } }."), { code: "BAD_REQUEST" });
  const text = (v, max = 200) => String(v ?? "").slice(0, max);
  return {
    reading: { pages: body.reading.pages },
    options: {
      party: text(body.party ?? "JIGEESHA AUTO SERVICES"),
      financialYear: text(body.financialYear, 7),
      narrationDate: text(body.narrationDate, 10) || undefined,
      month: Number.isInteger(body.month) ? body.month : undefined,
      ratesOverride: Object.fromEntries(Object.entries(body.ratesOverride ?? {}).map(([k, v]) => [k, finite(v)]).filter(([, v]) => v !== null)),
      mapping: Array.isArray(body.mapping) ? body.mapping.map((m) => ({ register: text(m.register, 10), nth: Number(m.nth), item: text(m.item), ledger: text(m.ledger) })) : undefined,
      accepted: Array.isArray(body.accepted) ? body.accepted.map((a) => ({ id: text(a.id), note: text(a.note) })) : [],
    },
  };
}

function build(body) {
  const { reading, options } = cleanOptions(body);
  return buildFuelRegister(reading, options);
}

async function handleFuelBuild(request) {
  const body = await request.json().catch(() => null);
  try {
    return json(build(body));
  } catch (error) {
    return fuelError(error.code ?? "BAD_REQUEST", error.message, 422);
  }
}

async function handleFuelExport(request) {
  const body = await request.json().catch(() => null);
  let result;
  try {
    result = build(body);
  } catch (error) {
    return fuelError(error.code ?? "BAD_REQUEST", error.message, 422);
  }
  if (!result.rows.length) return fuelError("NOTHING_TO_EXPORT", "No row has net sales, so there is nothing to export.", 422);
  // Unresolved flags need an explicit "Export anyway"; the Review sheet then lists them (and the accepted ones).
  if (result.unresolved && body.exportAnyway !== true) {
    return fuelError("UNRESOLVED_FLAGS", `${result.unresolved} check(s) are not resolved. Edit the values, accept them as read, or choose Export anyway.`, 409);
  }
  const buffer = await buildFuelWorkbookBuffer({ sheetName: result.period.sheetName, rows: result.rows, review: result.unresolved ? result.flags : null });
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Fuel_Register_${result.period.sheetName.replace(/ /g, "_")}.xlsx"`,
    },
  });
}

function handleFuelConfig() {
  const party = "JIGEESHA AUTO SERVICES";
  const { entryType, products } = FUEL_PARTIES[party];
  return json({ party, entryType, mapping: products.map(({ register, nth, item, ledger }) => ({ register, nth, item, ledger })), configured: providerConfigured("gemini") });
}

export { handleFuelBuild, handleFuelConfig, handleFuelConvertSubmit, handleFuelExport, handleFuelPage, handleFuelStatus, setFuelReader };
