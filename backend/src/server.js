import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

try {
  process.loadEnvFile();
} catch {
  // Ignored if loadEnvFile doesn't exist or .env is missing
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND_DIST = join(__dirname, "..", "..", "frontend", "dist");
const PORT = Number(process.env.PORT) || 8080;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Status per known conversion error code. Anything not listed here is treated as an unexpected
// server-side failure (500). The PDF_* codes come from the pre-flight content check
// (pdfPreflight.js) -- those are validation results ("this file has nothing to convert"), not
// crashes, so they get 422 rather than the generic 400 used for other known-bad-input codes.
const CONVERSION_ERROR_STATUS = {
  PASSWORD_REQUIRED: 400,
  INVALID_PASSWORD: 400,
  NO_TRANSACTIONS_FOUND: 400,
  OCR_KEY_MISSING: 400,
  OCR_FAILED: 400,
  OCR_NO_RESULTS: 400,
  PDF_NO_READABLE_CONTENT: 422,
  PDF_PREFLIGHT_OPEN_TOO_SLOW: 422,
};

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

async function handleConvertApi(request) {
  let tempFilePath;

  try {
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
      return Response.json(
        { code: "PDF_REQUIRED", message: "Upload a file to convert." },
        { status: 400 },
      );
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

    const [{ mkdir, writeFile }, { tmpdir }, { join: pathJoin, extname: pathExtname }, { randomUUID }] =
      await Promise.all([
        import("node:fs/promises"),
        import("node:os"),
        import("node:path"),
        import("node:crypto"),
      ]);

    const tempDir = pathJoin(tmpdir(), "statement-savior-conversions");
    await mkdir(tempDir, { recursive: true });
    const extension = pathExtname(file.name) || ".pdf";
    tempFilePath = pathJoin(tempDir, `${randomUUID()}${extension}`);
    await writeFile(tempFilePath, Buffer.from(await file.arrayBuffer()));

    const { convertPdfToExcelBuffer } = await import("./parsers/converter.js");

    const result = await convertPdfToExcelBuffer(tempFilePath, {
      password,
      scanned,
    });
    const workbookName = sanitizeWorkbookName(file.name);
    const transactionCount = result.statement.accounts
      ? result.statement.accounts.reduce((sum, account) => sum + account.transactions.length, 0)
      : (result.statement.transactions?.length ?? 0);

    return new Response(result.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${workbookName.replace(/["\r\n]/g, "")}"`,
        "X-Transaction-Count": String(transactionCount),
      },
    });
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
    return Response.json(
      { code: payload.code, message: payload.message, ...(payload.details || {}) },
      { status: payload.status },
    );
  } finally {
    if (tempFilePath) {
      const { rm } = await import("node:fs/promises");
      await rm(tempFilePath, { force: true }).catch(() => {});
    }
  }
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

async function nodeRequestToWebRequest(req) {
  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) chunks.push(chunk);
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
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/convert" && req.method === "POST") {
      const webRequest = await nodeRequestToWebRequest(req);
      const webResponse = await handleConvertApi(webRequest);
      res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
      res.end(Buffer.from(await webResponse.arrayBuffer()));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND", message: "Unknown API route." }));
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);
});
