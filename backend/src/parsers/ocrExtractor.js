import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { correctOcrToken } from "./ocrCorrections.js";
import { reconstructLinesFromWords } from "./ocrLineReconstructor.js";

const OCR_ENDPOINT = "https://api.ocr.space/parse/image";
// OCR.space's Free plan hard-rejects any single upload over 1.5 MB (confirmed via its own E556
// error response), not the far larger figure this used to check for. A multi-page PDF under that
// old 8 MB threshold but over ~1.5 MB (a 3-page, 2.3 MB scan is a real example) was being sent
// whole, guaranteed to 413, and silently fell back to the much lower-quality local Tesseract OCR
// path instead of ever being split into per-page requests that would each fit. Splitting well
// before the real limit (with headroom for multipart overhead) is what actually avoids that.
const LARGE_PDF_SPLIT_THRESHOLD_BYTES = 1.2 * 1024 * 1024;
// A single split-off page still keeps its source scan's original embedded image data (splitting
// just copies the page object, it doesn't re-encode anything), so a high-DPI scan's one-page PDF
// can easily still be over OCR.space's 1.5 MB cap on its own -- a real 8-page scan here averaged
// ~1.9 MB per page even after splitting. Rasterizing and JPEG-recompressing that one page (see
// rasterizeSinglePagePdfToJpeg below) before upload is what actually gets it under the limit,
// instead of silently losing the whole page to the much lower-quality local Tesseract fallback.
const OCR_SPACE_MAX_UPLOAD_BYTES = 1.4 * 1024 * 1024;
const OCR_RETRY_DELAYS_MS = [15000, 30000, 60000, 120000];

function getOcrApiKey() {
  return process.env.OCR_SPACE_API_KEY || "";
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\s]+/g, " ")
    .trim();
}

// Builds this page's lines directly from OCR word bounding boxes (see ocrLineReconstructor.js)
// instead of trusting OCR.space's own line grouping/order. OCR.space's "isTable" reflow mode can
// order a scanned table's words column-major instead of row-major on a noisy/skewed scan (all
// dates, then all references, then all amounts...), which silently scrambles reading order before
// any parsing code runs; reconstructing from raw word positions sidesteps that entirely.
function buildLinesFromParsedResult(parsedResult, pageNumber) {
  const words = [];
  for (const line of parsedResult.TextOverlay?.Lines || []) {
    for (const word of line.Words || []) {
      const wordLeft = Number(word.Left);
      const wordTop = Number(word.Top);
      const wordWidth = Number(word.Width);
      const wordHeight = Number(word.Height);
      const x = Number.isFinite(wordWidth) ? wordLeft + wordWidth / 2 : wordLeft;
      const y = Number.isFinite(wordHeight) ? wordTop + wordHeight / 2 : wordTop;
      const normalized = normalizeText(word.WordText);
      const corrected = correctOcrToken(normalized);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !corrected) continue;
      words.push({ x, y, text: corrected, corrected: corrected !== normalized });
    }
  }

  if (words.length > 0) {
    return reconstructLinesFromWords(words).map((line) => ({
      pageNumber,
      text: line.text,
      // Kept for parsers (e.g. bobWorldAppParser.js) that band lines into sections by vertical
      // position; reconstructLinesFromWords already computed these per reconstructed row.
      top: line.y,
      left: line.items[0]?.x ?? null,
      items: line.items,
      hadOcrCorrections: line.items.some((item) => item.corrected),
    }));
  }

  const lines = [];
  if (parsedResult.ParsedText) {
    for (const rawLine of String(parsedResult.ParsedText).split(/\r?\n/)) {
      const text = normalizeText(rawLine);
      if (text) lines.push({ pageNumber, text, top: null, left: null, items: [] });
    }
  }

  return lines;
}

async function requestOcr({ fileBuffer, fileName, mimeType, ext }) {
  const ocrApiKey = getOcrApiKey();
  if (!ocrApiKey) {
    const error = new Error("OCR API key is missing. Set OCR_SPACE_API_KEY.");
    error.code = "OCR_KEY_MISSING";
    throw error;
  }

  let response;
  for (let attempt = 0; attempt <= OCR_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const form = new FormData();
      form.append("apikey", ocrApiKey);
      form.append("language", "eng");
      form.append("isTable", "true");
      form.append("isOverlayRequired", "true");
      form.append("OCREngine", "2");
      form.append("detectOrientation", "true");
      form.append("scale", "true");
      if (ext === ".pdf") {
        form.append("filetype", "PDF");
      }
      form.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);

      response = await fetch(OCR_ENDPOINT, {
        method: "POST",
        body: form,
      });
    } catch (error) {
      if (attempt >= OCR_RETRY_DELAYS_MS.length) throw error;
    }

    if (response?.ok) break;
    if (response?.status === 429) break;
    if (response && ![408, 429, 500, 502, 503, 504].includes(response.status)) break;
    if (attempt >= OCR_RETRY_DELAYS_MS.length) break;

    const retryAfterSeconds = Number(response?.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 0;
    const delayMs = Math.max(OCR_RETRY_DELAYS_MS[attempt], retryAfterMs);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response?.ok) {
    const error = new Error(`OCR request failed with status ${response?.status || "unknown"}`);
    error.code = "OCR_HTTP_FAILED";
    error.status = response?.status;
    throw error;
  }

  const payload = await response.json();
  if (payload.IsErroredOnProcessing) {
    const message = payload.ErrorMessage?.join(" ") || payload.ErrorMessage || "OCR processing failed.";
    const error = new Error(message);
    if (/maximum page limit|pages upto the limit|page limit of/i.test(message)) {
      error.code = "OCR_PAGE_LIMIT";
    } else {
      error.code = "OCR_FAILED";
    }
    throw error;
  }

  const parsedResults = payload.ParsedResults || [];
  if (!parsedResults.length) {
    const error = new Error("No OCR results returned from the OCR service.");
    error.code = "OCR_NO_RESULTS";
    throw error;
  }

  return parsedResults;
}

// PDF page coordinates are in points (1/72 inch); scale 4.17 renders at roughly 300 DPI, which
// gives Tesseract meaningfully more pixels per character than the previous scale of 2 (~144 DPI)
// -- important for faded photocopies where character strokes are already thin.
const LOCAL_OCR_TARGET_DPI = 300;
const PDF_POINTS_PER_INCH = 72;

// Grayscale + contrast-stretch + binarize the rendered page in place. This is a lightweight
// substitute for a full CV preprocessing pipeline (deskew/adaptive-threshold would need a native
// dependency like OpenCV, which is disproportionate here): it mainly helps faded/low-contrast
// scans by pushing midtones toward pure black or white before Tesseract sees them.
function preprocessImageData(imageData) {
  const { data } = imageData;
  const grays = new Uint8ClampedArray(data.length / 4);

  let min = 255;
  let max = 0;
  for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grays[g] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  const range = Math.max(1, max - min);
  const STRETCHED_THRESHOLD = 255 * 0.55;

  for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
    const stretched = ((grays[g] - min) / range) * 255;
    const value = stretched >= STRETCHED_THRESHOLD ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  return imageData;
}

async function loadCanvasAndPdfjs() {
  const canvasApi = await import("@napi-rs/canvas");
  globalThis.Path2D = canvasApi.Path2D;
  globalThis.DOMMatrix = canvasApi.DOMMatrix;
  globalThis.ImageData = canvasApi.ImageData;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return { canvasApi, pdfjs };
}

// Renders a single PDF page (assumed to be the only page in `fileBuffer`, as produced by
// splitPdfPages) to a JPEG under `maxBytes`, stepping down DPI and JPEG quality until it fits.
// Used to get an oversized scanned page under OCR.space's upload cap without losing it entirely
// to the much lower-quality local Tesseract fallback.
async function rasterizeSinglePagePdfToJpeg(fileBuffer, maxBytes) {
  const { canvasApi, pdfjs } = await loadCanvasAndPdfjs();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  const page = await pdf.getPage(1);

  const attempts = [
    { dpi: 300, quality: 85 },
    { dpi: 300, quality: 65 },
    { dpi: 220, quality: 70 },
    { dpi: 150, quality: 70 },
  ];

  let smallest = null;
  for (const { dpi, quality } of attempts) {
    const scale = dpi / PDF_POINTS_PER_INCH;
    const viewport = page.getViewport({ scale });
    const canvas = canvasApi.createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;

    const jpeg = await canvas.encode("jpeg", quality);
    if (!smallest || jpeg.length < smallest.length) smallest = jpeg;
    if (jpeg.length <= maxBytes) return jpeg;
  }

  return smallest;
}

async function runLocalPdfOcr(fileBuffer, logs = []) {
  const { canvasApi, pdfjs } = await loadCanvasAndPdfjs();
  const { tmpdir } = await import("node:os");
  const cachePath = path.join(tmpdir(), "statement-savior-tesseract");
  await fs.mkdir(cachePath, { recursive: true });

  const Tesseract = await import("tesseract.js").then((module) => module.default || module);

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  let text = "";

  logs.push({ level: "info", stage: "ocr", message: `Local OCR started for ${pdf.numPages} page(s).`, pagesProcessed: pdf.numPages });

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageStart = Date.now();
    const page = await pdf.getPage(pageNumber);
    const scale = LOCAL_OCR_TARGET_DPI / PDF_POINTS_PER_INCH;
    const viewport = page.getViewport({ scale });
    const canvas = canvasApi.createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    context.putImageData(preprocessImageData(imageData), 0, 0);

    const png = await canvas.encode("png");
    const result = await Tesseract.recognize(png, "eng", { cachePath });
    text += `${result.data.text || ""}\n`;
    logs.push({
      level: "info",
      stage: "ocr",
      message: `Local OCR completed for page ${pageNumber}.`,
      pagesProcessed: 1,
      durationMs: Date.now() - pageStart,
    });
  }

  return [{ ParsedText: text }];
}

async function splitPdfPages(fileBuffer, fileName) {
  const pdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  const pages = [];

  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(pdf, [pageIndex]);
    output.addPage(page);
    pages.push({
      pageNumber: pageIndex + 1,
      fileName: `${path.basename(fileName, ".pdf")}-page-${pageIndex + 1}.pdf`,
      fileBuffer: Buffer.from(await output.save()),
    });
  }

  return pages;
}

// Runs `worker` over `items` with at most `limit` in flight at once, returning results in the
// same order as `items` (page order matters downstream, so this isn't a plain Promise.all).
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

const OCR_PAGE_CONCURRENCY = 3;
// Caps a single page's OCR work (remote OCR.space call including its own retries, or the local
// Tesseract fallback) so one slow/stuck page can't hold up -- or hang -- the whole file. A page
// that blows this budget is skipped, not retried forever: the conversion continues with the rest
// of the pages and reports which page(s) it had to drop and why.
const PAGE_OCR_TIMEOUT_MS = 45000;

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(timeoutMessage);
      error.code = "OCR_PAGE_TIMEOUT";
      reject(error);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function extractScannedFile(filePath) {
  const cachePath = filePath + ".ocr.json";
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    console.log("Loading OCR results from cache file:", cachePath);
    const parsed = JSON.parse(cached);
    return { logs: [], ...parsed, source: "ocr" };
  } catch (err) {
    // Cache miss, proceed
  }

  const logs = [];

  const fileBuffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeByExt = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  const mimeType = mimeByExt[ext] || "application/octet-stream";

  let pageCount = 1;
  if (ext === ".pdf") {
    try {
      const pdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      pageCount = pdf.getPageCount();
    } catch (e) {
      console.warn("Failed to load PDF to count pages:", e);
    }
  }

  const shouldSplitPdf = ext === ".pdf" && (pageCount > 3 || fileBuffer.length > LARGE_PDF_SPLIT_THRESHOLD_BYTES);
  let parsedResults = [];

  logs.push({ level: "info", stage: "ocr", message: `OCR started for ${pageCount} page(s).`, pagesProcessed: pageCount });
  const ocrStart = Date.now();

  const skippedPages = [];

  if (shouldSplitPdf) {
    const pageFiles = await splitPdfPages(fileBuffer, fileName);
    const perPageResults = await mapWithConcurrency(pageFiles, OCR_PAGE_CONCURRENCY, async (pageFile) => {
      const pageStart = Date.now();
      let pageResults;
      let pathTaken = "remote-ocr";
      try {
        let uploadBuffer = pageFile.fileBuffer;
        let uploadFileName = pageFile.fileName;
        let uploadMimeType = mimeType;
        let uploadExt = ext;

        if (ext === ".pdf" && pageFile.fileBuffer.length > OCR_SPACE_MAX_UPLOAD_BYTES) {
          const jpeg = await rasterizeSinglePagePdfToJpeg(pageFile.fileBuffer, OCR_SPACE_MAX_UPLOAD_BYTES);
          if (jpeg) {
            uploadBuffer = jpeg;
            uploadFileName = pageFile.fileName.replace(/\.pdf$/i, ".jpg");
            uploadMimeType = "image/jpeg";
            uploadExt = ".jpg";
          }
        }

        pageResults = await withTimeout(
          requestOcr({
            fileBuffer: uploadBuffer,
            fileName: uploadFileName,
            mimeType: uploadMimeType,
            ext: uploadExt,
          }),
          PAGE_OCR_TIMEOUT_MS,
          `Remote OCR timed out for page ${pageFile.pageNumber} after ${PAGE_OCR_TIMEOUT_MS / 1000}s`,
        );
      } catch (error) {
        console.warn(
          "OCR.Space failed for page",
          pageFile.pageNumber,
          "- falling back to local OCR:",
          error?.message || error,
        );
        pathTaken = "local-ocr";
        try {
          pageResults = await withTimeout(
            runLocalPdfOcr(pageFile.fileBuffer, logs),
            PAGE_OCR_TIMEOUT_MS,
            `Local OCR timed out for page ${pageFile.pageNumber} after ${PAGE_OCR_TIMEOUT_MS / 1000}s`,
          );
        } catch (localError) {
          pathTaken = "skipped";
          const reason = localError?.message || String(localError);
          console.warn("Page", pageFile.pageNumber, "skipped -", reason);
          skippedPages.push({ pageNumber: pageFile.pageNumber, reason });
          logs.push({
            level: "warn",
            stage: "ocr",
            message: `Page ${pageFile.pageNumber} skipped: ${reason}`,
            pagesProcessed: 0,
          });
          pageResults = [{ ParsedText: "" }];
        }
      }
      logs.push({
        level: "info",
        stage: "ocr",
        message: `Page ${pageFile.pageNumber} extracted via ${pathTaken}.`,
        pagesProcessed: 1,
        durationMs: Date.now() - pageStart,
      });
      return pageResults.map((result) => ({ ...result, Page: pageFile.pageNumber }));
    });
    parsedResults = perPageResults.flat();
  } else {
    try {
      parsedResults.push(
        ...(await requestOcr({
          fileBuffer,
          fileName,
          mimeType,
          ext,
        })),
      );
    } catch (error) {
      console.warn("OCR.Space failed for file", fileName, "- falling back to local OCR:", error?.message || error);
      parsedResults.push(...(await runLocalPdfOcr(fileBuffer, logs)));
    }
  }

  logs.push({
    level: "info",
    stage: "ocr",
    message:
      skippedPages.length > 0
        ? `Converted ${pageCount - skippedPages.length}/${pageCount} page(s). Failed/skipped: ` +
          skippedPages.map((page) => `page ${page.pageNumber} (${page.reason})`).join(", ") +
          "."
        : `OCR completed for ${pageCount} page(s).`,
    pagesProcessed: pageCount,
    durationMs: Date.now() - ocrStart,
  });

  const pages = [];
  const lines = [];

  for (let index = 0; index < parsedResults.length; index += 1) {
    const parsed = parsedResults[index];
    const pageNumber = parsed.Page ?? index + 1;
    const pageLines = buildLinesFromParsedResult(parsed, pageNumber);
    pages.push({ pageNumber, lines: pageLines });
    lines.push(...pageLines);
  }

  logs.push({
    level: "info",
    stage: "ocr",
    message: `${lines.length} line(s) detected across ${pages.length} page(s).`,
  });

  const result = {
    pageCount: pages.length,
    pages,
    lines,
    text: lines.map((line) => line.text).join("\n"),
    source: "ocr",
    skippedPages,
    logs,
  };

  try {
    await fs.writeFile(cachePath, JSON.stringify(result, null, 2), "utf8");
    console.log("Saved OCR results to cache file:", cachePath);
  } catch (err) {
    console.warn("Failed to save OCR cache:", err);
  }

  return result;
}

export { extractScannedFile, splitPdfPages, requestOcr };
