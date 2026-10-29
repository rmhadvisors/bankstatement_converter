import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import process from "node:process";
// Static, not await import() per job: in dev (`node --watch-path=./src`) a source file read for the
// first time mid-request bumps its Windows last-access time, which the watcher reports as a change
// and restarts the server -- dropping every in-memory job (the client then polls into a 404).
import { convertPdfToExcelBuffer } from "./parsers/converter.js";
import { convertCreditCardToExcelBuffer } from "./creditcard/ccConverter.js";
import {
  handleInvoiceConfig,
  handleInvoiceConvertSubmit,
  handleInvoiceExport,
  handleInvoiceStatus,
  handleInvoiceValidate,
} from "./invoice/service.js";

try {
  process.loadEnvFile();
} catch {
  // Ignored if loadEnvFile doesn't exist or .env is missing
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND_DIST = join(__dirname, "..", "..", "frontend", "dist");
// PORT=0 (tests) means "any free port" -- `Number(PORT) || 8080` turned it into 8080 and collided
// with the dev server. Unset or empty PORT still means 8080.
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_DIR = join(tmpdir(), "statement-savior-conversions");
const STALE_UPLOAD_MS = 60 * 60 * 1000;

// Frontend and backend deploy as separate origins (e.g. Vercel + Hostinger), so the browser
// enforces CORS on every /api request. ALLOWED_ORIGIN takes a comma-separated list to cover a
// production domain plus Vercel preview-deployment URLs; unset falls back to the local Vite dev
// server so `npm run dev` keeps working without any env setup.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "http://localhost:8090")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition, X-Transaction-Count, X-Reconciliation-Status, X-Reconciliation-Difference, X-Reconciliation-Warning, X-Conversion-Status, X-Review-Reasons",
    );
  }
}

// Status per known conversion error code. Anything not listed here is treated as an unexpected
// server-side failure (500). The PDF_* codes come from the pre-flight content check
// (pdfPreflight.js) -- those are validation results ("this file has nothing to convert"), not
// crashes, so they get 422 rather than the generic 400 used for other known-bad-input codes.
const CONVERSION_ERROR_STATUS = {
  PASSWORD_REQUIRED: 400,
  INVALID_PASSWORD: 400,
  NO_TRANSACTIONS_FOUND: 400,
  UNSUPPORTED_LAYOUT: 422,
  OCR_KEY_MISSING: 400,
  OCR_FAILED: 400,
  OCR_NO_RESULTS: 400,
  PDF_NO_READABLE_CONTENT: 422,
  PDF_PREFLIGHT_OPEN_TOO_SLOW: 422,
  CREDIT_CARD_STATEMENT: 422,
  WRONG_PASSWORD: 400,
  NOT_A_CREDIT_CARD_STATEMENT: 422,
  UNSUPPORTED_ISSUER: 422,
  ENCRYPTED_SCAN_UNSUPPORTED: 422,
};

// Conversion (OCR especially) can run for minutes on a large scanned PDF -- far longer than any
// reverse proxy in front of this process (Hostinger's included) will hold a request open, which is
// what was turning long conversions into a bare 502 with no error message. Jobs run in the
// background instead: POST starts one and returns immediately, GET polls for the result. An
// in-memory Map is enough here (single Node process, no queue infra) -- finished entries are swept
// JOB_TTL_MS after completion (never while running) so a client that never polls again doesn't
// leak memory.
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

// Card jobs are deleted as soon as their workbook is downloaded; this is only the fallback for a
// client that never comes back for it.
const CARD_JOB_TTL_MS = 10 * 60 * 1000;

// kind is "bank" or "credit_card": each status route only serves its own kind of job.
function createJob(kind) {
  const id = crypto.randomUUID();
  jobs.set(id, { status: "pending", kind });
  return id;
}

function finishJob(id, update, ttlMs = JOB_TTL_MS) {
  jobs.set(id, { kind: jobs.get(id)?.kind, ...update, expiresAt: Date.now() + ttlMs });
  setTimeout(() => jobs.delete(id), ttlMs).unref();
}

async function saveUpload(file) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const extension = /^\.[a-z0-9]{1,5}$/i.test(extname(file.name)) ? extname(file.name) : ".pdf";
  const filePath = join(UPLOAD_DIR, `${crypto.randomUUID()}${extension}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  return filePath;
}

// The OCR step caches its text next to the upload as <upload>.ocr.json -- statement contents, so
// it goes with the upload.
async function removeUpload(filePath) {
  await Promise.all(
    [filePath, `${filePath}.ocr.json`].map((target) => rm(target, { force: true }).catch(() => {})),
  );
}

// Leftovers from a crash or restart mid-conversion. Only run at startup, when no job is in flight.
async function sweepStaleUploads() {
  const names = await readdir(UPLOAD_DIR).catch(() => []);
  const cutoff = Date.now() - STALE_UPLOAD_MS;
  await Promise.all(
    names.map(async (name) => {
      const target = join(UPLOAD_DIR, name);
      const info = await stat(target).catch(() => null);
      if (info?.isFile() && info.mtimeMs < cutoff)
        await rm(target, { force: true }).catch(() => {});
    }),
  );
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getConversionErrorPayload(error) {
  const code = error?.code || "CONVERSION_FAILED";
  const message =
    typeof error?.message === "string" && error.message.trim()
      ? error.message
      : "Could not convert this statement.";

  const details =
    code === "PDF_NO_READABLE_CONTENT"
      ? {
          pagesScanned: error?.pagesScanned,
          totalPages: error?.totalPages,
          emptyPages: error?.emptyPages,
          imagesFound: error?.imagesFound,
        }
      : undefined;

  return {
    code,
    message,
    status: CONVERSION_ERROR_STATUS[code] ?? 500,
    details,
  };
}

function sanitizeWorkbookName(fileName) {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*]/g, "")
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .trim();
  return `${base || "statement"}.xlsx`;
}

// Runs the actual conversion in the background (not awaited by the request handler) so a
// multi-minute OCR job never holds an HTTP request open past a reverse proxy's timeout. Always
// resolves -- failures are recorded on the job instead of thrown, since nothing is left awaiting
// this promise directly.
async function runConversionJob(jobId, tempFilePath, fileName, options) {
  try {
    const result = await convertPdfToExcelBuffer(tempFilePath, {
      ...options,
      // Spread the job: handleConvertStatus needs its `kind` to keep answering 202.
      onProgress: ({ page, totalPages }) => jobs.set(jobId, { ...jobs.get(jobId), status: "processing", page, totalPages }),
    });
    const workbookName = sanitizeWorkbookName(fileName);
    const transactionCount = result.statement.accounts
      ? result.statement.accounts.reduce((sum, account) => sum + account.transactions.length, 0)
      : (result.statement.transactions?.length ?? 0);

    finishJob(jobId, { status: "done", buffer: result.buffer, workbookName, transactionCount, review: result.statement.review });
  } catch (error) {
    const payload = getConversionErrorPayload(error);
    // A pre-flight validation rejection (bad/empty PDF) is an expected result, not a server
    // fault -- logging it at error level would bury real crashes in routine "this file is
    // unusable" noise.
    if (payload.status >= 500) {
      console.error(error);
    } else {
      console.warn(`/api/convert rejected: ${payload.code} - ${payload.message}`);
    }
    finishJob(jobId, { status: "error", payload });
  } finally {
    await removeUpload(tempFilePath);
  }
}

// Same background-job shape as runConversionJob. Logs carry only the error code or stack: statement
// text, card numbers and passwords never reach the console.
async function runCreditCardJob(jobId, tempFilePath, fileName, options) {
  try {
    const { buffer, statement } = await convertCreditCardToExcelBuffer(tempFilePath, options);
    finishJob(
      jobId,
      {
        status: "done",
        buffer,
        workbookName: sanitizeWorkbookName(fileName),
        transactionCount: statement.transactions.length,
        reconciliation: statement.reconciliation,
      },
      CARD_JOB_TTL_MS,
    );
  } catch (error) {
    const payload = getConversionErrorPayload(error);
    if (payload.status >= 500) {
      console.error("/api/credit-card/convert failed:", error?.stack || error?.message);
    } else {
      console.warn(`/api/credit-card/convert rejected: ${payload.code}`);
    }
    finishJob(jobId, { status: "error", payload }, CARD_JOB_TTL_MS);
  } finally {
    await removeUpload(tempFilePath);
  }
}

async function handleConvertSubmit(request) {
  const form = await request.formData();
  const file = form.get("statement") || form.get("file");
  const passwordField = form.get("password");
  const scannedField = form.get("scanned");
  const password = typeof passwordField === "string" ? passwordField : "";
  const scanned = scannedField === "true" || scannedField === true;

  console.log("/api/convert request", {
    fileName: file instanceof File ? file.name : null,
    scanned,
    passwordProvided: Boolean(password),
    passwordLength: password.length,
  });

  if (!(file instanceof File)) {
    return Response.json({ code: "PDF_REQUIRED", message: "Upload a file to convert." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { code: "FILE_TOO_LARGE", message: "Files must be 100 MB or smaller." },
      { status: 400 },
    );
  }

  if (!scanned && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    return Response.json(
      { code: "PDF_REQUIRED", message: "Only PDF files are supported for native conversion." },
      { status: 400 },
    );
  }

  if (scanned && !/(?:pdf|jpeg|jpg|png|tiff|tif)$/i.test(file.name) && !file.type.startsWith("image/")) {
    return Response.json(
      { code: "FILE_TYPE_NOT_SUPPORTED", message: "Only PDF or image files are supported for scanned conversion." },
      { status: 400 },
    );
  }

  const tempFilePath = await saveUpload(file);
  const jobId = createJob("bank");
  runConversionJob(jobId, tempFilePath, file.name, { password, scanned });

  return Response.json({ jobId }, { status: 202 });
}

function handleConvertStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.kind !== "bank") {
    return Response.json({ code: "JOB_NOT_FOUND", message: "Unknown or expired conversion job." }, { status: 404 });
  }

  if (job.status === "pending" || job.status === "processing") {
    return Response.json(job, { status: 202 });
  }

  if (job.status === "error") {
    const { payload } = job;
    return Response.json(
      { code: payload.code, message: payload.message, ...(payload.details || {}) },
      { status: payload.status },
    );
  }

  return new Response(job.buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${job.workbookName.replace(/["\r\n]/g, "")}"`,
      "X-Transaction-Count": String(job.transactionCount),
      // "ok" | "needs_review"; reasons as URI-encoded JSON (headers must stay ASCII).
      "X-Conversion-Status": job.review?.status || "ok",
      "X-Review-Reasons": encodeURIComponent(JSON.stringify(job.review?.reasons || [])),
    },
  });
}

// Card endpoints answer errors as { error, code, message }.
function cardError(code, message, status) {
  return Response.json({ error: message, code, message }, { status });
}

async function handleCreditCardSubmit(request) {
  const form = await request.formData();
  const file = form.get("statement") || form.get("file");
  const passwordField = form.get("password");
  const password = typeof passwordField === "string" ? passwordField : "";

  if (!(file instanceof File)) {
    return cardError("FILE_REQUIRED", "Upload a credit card statement to convert.", 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return cardError("FILE_TOO_LARGE", "Files must be 100 MB or smaller.", 400);
  }
  if (
    !/\.(?:pdf|jpe?g|png|tiff?)$/i.test(file.name) &&
    file.type !== "application/pdf" &&
    !file.type.startsWith("image/")
  ) {
    return cardError("FILE_TYPE_NOT_SUPPORTED", "Upload the statement as a PDF or an image.", 400);
  }

  const tempFilePath = await saveUpload(file);
  const jobId = createJob("credit_card");
  runCreditCardJob(jobId, tempFilePath, file.name, { password });
  return Response.json({ jobId }, { status: 202 });
}

// The workbook is dropped from memory once the response has been fully written ('finish'), not
// when it is handed over: a download that breaks off midway leaves the job for a retry.
function handleCreditCardStatus(jobId, res) {
  const job = jobs.get(jobId);
  if (!job || job.kind !== "credit_card") {
    return cardError("JOB_NOT_FOUND", "Unknown or expired conversion job.", 404);
  }
  if (job.status === "pending") {
    return Response.json({ status: "pending" }, { status: 202 });
  }
  if (job.status === "error") {
    const { payload } = job;
    return Response.json(
      {
        error: payload.message,
        code: payload.code,
        message: payload.message,
        ...(payload.details || {}),
      },
      { status: payload.status },
    );
  }

  const { reconciliation } = job;
  res.once("finish", () => jobs.delete(jobId));
  return new Response(job.buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${job.workbookName.replace(/["\r\n]/g, "")}"`,
      "X-Transaction-Count": String(job.transactionCount),
      "X-Reconciliation-Status": reconciliation.status,
      "X-Reconciliation-Difference": String(reconciliation.checks[0]?.difference ?? ""),
      // Headers must be ASCII; the client decodeURIComponent()s this.
      "X-Reconciliation-Warning": encodeURIComponent(reconciliation.warnings.join(" ")),
    },
  });
}

async function sendWebResponse(res, webResponse) {
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  res.end(Buffer.from(await webResponse.arrayBuffer()));
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  let filePath = join(FRONTEND_DIST, decodeURIComponent(safePath));

  // SPA fallback: unknown, non-file routes resolve to index.html so the
  // client-side router can take over.
  if (!existsSync(filePath) || extname(filePath) === "") {
    filePath = join(FRONTEND_DIST, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

// Multipart framing and the password field on top of a 100 MB file.
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

// Returns null once the body exceeds MAX_REQUEST_BYTES, so an oversized upload is never buffered.
async function nodeRequestToWebRequest(req) {
  const chunks = [];
  let size = 0;
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) return null;
      chunks.push(chunk);
    }
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
  });
}

const server = createServer(async (req, res) => {
  try {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/convert" && req.method === "POST") {
      const webRequest = await nodeRequestToWebRequest(req);
      await sendWebResponse(
        res,
        webRequest
          ? await handleConvertSubmit(webRequest)
          : Response.json({ code: "FILE_TOO_LARGE", message: "Files must be 100 MB or smaller." }, { status: 413 }),
      );
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/convert\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      await sendWebResponse(res, handleConvertStatus(jobMatch[1]));
      return;
    }

    if (url.pathname === "/api/credit-card/convert" && req.method === "POST") {
      await sendWebResponse(res, await handleCreditCardSubmit(await nodeRequestToWebRequest(req)));
      return;
    }

    const cardJobMatch = url.pathname.match(/^\/api\/credit-card\/convert\/([^/]+)$/);
    if (cardJobMatch && req.method === "GET") {
      await sendWebResponse(res, handleCreditCardStatus(cardJobMatch[1], res));
      return;
    }

    // Invoice / receipt converter (backend/src/invoice/service.js).
    if (url.pathname.startsWith("/api/invoice/")) {
      const invoiceJob = url.pathname.match(/^\/api\/invoice\/convert\/([^/]+)$/);
      if (invoiceJob && req.method === "GET") return sendWebResponse(res, handleInvoiceStatus(invoiceJob[1]));
      if (url.pathname === "/api/invoice/config" && req.method === "GET") return sendWebResponse(res, await handleInvoiceConfig());
      const handler = {
        "/api/invoice/convert": handleInvoiceConvertSubmit,
        "/api/invoice/validate": handleInvoiceValidate,
        "/api/invoice/export": handleInvoiceExport,
      }[url.pathname];
      if (handler && req.method === "POST") {
        const webRequest = await nodeRequestToWebRequest(req);
        return sendWebResponse(
          res,
          webRequest ? await handler(webRequest) : Response.json({ code: "FILE_TOO_LARGE", message: "Files must be 100 MB or smaller." }, { status: 413 }),
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND", message: "Unknown API route." }));
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(`${req.method} ${req.url} failed:`, error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "SERVER_ERROR", message: `Server error: ${error?.message || "unknown error"}` }));
  }
});

await sweepStaleUploads().catch((error) =>
  console.warn("Stale upload sweep failed:", error?.message),
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${server.address().port}`);
});
