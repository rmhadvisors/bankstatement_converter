import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
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
  const boxes = (parsedResult.TextOverlay?.Lines || []).flatMap((line) =>
    (line.Words || []).map((word) => ({
      text: word.WordText,
      left: Number(word.Left),
      top: Number(word.Top),
      width: Number(word.Width),
      height: Number(word.Height),
    })),
  );
  const lines = buildLinesFromWordBoxes(boxes, pageNumber);
  if (lines.length > 0) return lines;

  if (parsedResult.ParsedText) {
    for (const rawLine of String(parsedResult.ParsedText).split(/\r?\n/)) {
      const text = normalizeText(rawLine);
      if (text) lines.push({ pageNumber, text, top: null, left: null, items: [] });
    }
  }

  return lines;
}

// boxes: [{ text, left, top, width, height }] in image pixels (y down).
function buildLinesFromWordBoxes(boxes, pageNumber) {
  const words = [];
  for (const word of boxes) {
    const x = Number.isFinite(word.width) ? word.left + word.width / 2 : word.left;
    const y = Number.isFinite(word.height) ? word.top + word.height / 2 : word.top;
    const normalized = normalizeText(word.text);
    const corrected = correctOcrToken(normalized);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !corrected) continue;
    words.push({ x, y, text: corrected, corrected: corrected !== normalized });
  }

  return reconstructLinesFromWords(words).map((line) => ({
    pageNumber,
    // OCR.space returns "01-10-2024" as three words "01 - 10 - 2024" (seen on ICICI scans);
    // rejoin them so the date regexes in every parser still match.
    text: line.text.replace(/\b(\d{1,2}) ?([-/.]) ?(\d{1,2}) ?\2 ?(\d{2,4})\b/g, "$1$2$3$2$4"),
    // Kept for parsers (e.g. bobWorldAppParser.js) that band lines into sections by vertical
    // position; reconstructLinesFromWords already computed these per reconstructed row.
    top: line.y,
    left: line.items[0]?.x ?? null,
    items: line.items,
    hadOcrCorrections: line.items.some((item) => item.corrected),
  }));
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

  removeRuleLines(imageData);
  return imageData;
}

// Table grid lines (e.g. ICICI's boxed "Date | Particulars | ... | Balance" table) make Tesseract
// merge cells into garbage like "[05 02024 [wer Eso TRG ...". No glyph at 300 DPI has a straight
// black run longer than ~0.3", so whiten every horizontal/vertical run at least that long.
// ponytail: plain run-length rule removal; a solid black block (photo, stamp) is erased too, which
// is fine for statements. Upgrade path is morphological opening if that ever matters.
const RULE_MIN_RUN = Math.round(LOCAL_OCR_TARGET_DPI * 0.3);

function removeRuleLines({ data, width, height }) {
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const rule = new Uint8Array(width * height);
  const scan = (outer, inner, idx) => {
    for (let o = 0; o < outer; o += 1) {
      let start = 0;
      for (let i = 0; i <= inner; i += 1) {
        if (i < inner && isBlack(...idx(o, i))) continue;
        if (i - start >= RULE_MIN_RUN) for (let k = start; k < i; k += 1) { const [x, y] = idx(o, k); rule[y * width + x] = 1; }
        start = i + 1;
      }
    }
  };
  scan(height, width, (y, x) => [x, y]);
  scan(width, height, (x, y) => [x, y]);
  for (let p = 0; p < rule.length; p += 1) {
    if (rule[p]) data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
  }
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

// OCR.space plans cap pages/requests per day and file size, so a long statement is OCR'd locally
// instead (a 231-page merged statement would otherwise be 231 remote calls, each able to fail
// over to a slow per-page fallback).
const REMOTE_OCR_MAX_PAGES = 30;
const NATIVE_PAGE_TIMEOUT_MS = 120000;
const CHECKPOINT_ROOT = path.join(os.tmpdir(), "statement-savior-ocr");
// ponytail: checkpoints of a crashed job are only swept by age on the next local OCR run.
const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// A page with at least this much text-layer text is read directly instead of OCR'd. Below it the
// page is treated as image/vector-only (e.g. a "Digitally signed by DS HDFC Bank Ltd" stamp is the
// only real text over vector-drawn glyphs).
const MIN_TEXT_LAYER_CHARS = 100;

let tesseractBinaryPromise;
function findTesseractBinary() {
  tesseractBinaryPromise ??= (async () => {
    const candidates = [
      process.env.TESSERACT_PATH,
      "tesseract",
      process.platform === "win32" ? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe" : null,
    ].filter(Boolean);
    for (const bin of candidates) {
      const ok = await new Promise((resolve) => execFile(bin, ["--version"], { windowsHide: true }, (error) => resolve(!error)));
      if (ok) return bin;
    }
    return null;
  })();
  return tesseractBinaryPromise;
}

// Level-5 (word) rows of Tesseract's TSV output. The CLI prints a header row, tesseract.js does not;
// filtering on level covers both.
function parseTesseractTsv(tsv) {
  const words = [];
  for (const row of String(tsv || "").split(/\r?\n/)) {
    const cols = row.split("\t");
    if (cols[0] !== "5" || cols.length < 12) continue;
    const text = cols.slice(11).join(" ").trim();
    if (text) words.push({ text, left: +cols[6], top: +cols[7], width: +cols[8], height: +cols[9] });
  }
  return words;
}

function ocrImageNative(bin, imagePath) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [imagePath, "stdout", "--psm", "6", "tsv"],
      {
        // One thread per process: the pool already runs one process per core.
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: NATIVE_PAGE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(parseTesseractTsv(stdout))),
    );
  });
}

// Fallback when the tesseract binary isn't installed: a fixed pool of reused tesseract.js workers.
async function createTesseractJsPool(size) {
  const Tesseract = await import("tesseract.js").then((module) => module.default || module);
  const cachePath = path.join(os.tmpdir(), "statement-savior-tesseract");
  await fs.mkdir(cachePath, { recursive: true });
  const workers = await Promise.all(Array.from({ length: size }, () => Tesseract.createWorker("eng", 1, { cachePath })));
  await Promise.all(workers.map((worker) => worker.setParameters({ tessedit_pageseg_mode: "6" })));
  const idle = [...workers];
  return {
    async ocr(imagePath) {
      const worker = idle.pop();
      try {
        const { data } = await worker.recognize(await fs.readFile(imagePath), {}, { tsv: true });
        return parseTesseractTsv(data.tsv);
      } finally {
        idle.push(worker);
      }
    },
    terminate: () => Promise.all(workers.map((worker) => worker.terminate())),
  };
}

// Renders straight to an 8-bit grayscale PGM: no PNG encode on the main thread (~1 s/page at
// 300 DPI), a quarter of the RGBA bytes on disk, and Tesseract/Leptonica read PNM natively.
async function renderPageToPgm(page, canvasApi, viewport, outPath) {
  const canvas = canvasApi.createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`);
  const gray = Buffer.allocUnsafe(width * height);
  for (let i = 0, g = 0; g < gray.length; i += 4, g += 1) {
    gray[g] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  whitenGrayRules(gray, width, height);
  await fs.writeFile(outPath, Buffer.concat([header, gray]));
}

// Same idea as removeRuleLines, on the grayscale buffer: table borders touching a cell's first
// letter otherwise OCR as fused artifacts ("|ACCOUNT" -> "AACCOUNT", "|BABAR" -> "IBBABAR").
function whitenGrayRules(gray, width, height) {
  const isDark = (index) => gray[index] < 200;
  const rule = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      if (x < width && isDark(y * width + x)) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (x - start >= RULE_MIN_RUN) rule.fill(1, y * width + start, y * width + x);
        start = -1;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
      if (y < height && isDark(y * width + x)) {
        if (start < 0) start = y;
      } else if (start >= 0) {
        if (y - start >= RULE_MIN_RUN) for (let k = start; k < y; k += 1) rule[k * width + x] = 1;
        start = -1;
      }
    }
  }
  for (let index = 0; index < rule.length; index += 1) if (rule[index]) gray[index] = 255;
}

// Text-layer items as word boxes in the same pixel space the OCR'd pages use.
async function readTextLayerWords(page, pdfjs, viewport) {
  const content = await page.getTextContent();
  const words = [];
  for (const item of content.items) {
    const text = normalizeText(item.str);
    if (!text) continue;
    const [, , c, d, e, f] = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(c, d);
    words.push({ text, left: e, top: f - height, width: item.width * viewport.scale, height });
  }
  return words;
}

async function sweepStaleCheckpoints() {
  const entries = await fs.readdir(CHECKPOINT_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const dir = path.join(CHECKPOINT_ROOT, entry.name);
    const stat = await fs.stat(dir).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > CHECKPOINT_MAX_AGE_MS) await fs.rm(dir, { recursive: true, force: true });
  }
}

// Page-by-page local extraction for long PDFs: render one page -> OCR it -> keep only its word
// boxes -> drop the bitmap. Pages that carry a real text layer are read directly instead. OCR runs
// in a fixed pool (one slot per core) while the main thread renders the next page. Each finished
// page is checkpointed under a hash of the file, so a crashed/restarted job resumes; the
// checkpoints are deleted once extraction finishes or fails.
async function extractPdfLocally(filePath, { password, onProgress } = {}) {
  const logs = [];
  const start = Date.now();
  const { canvasApi, pdfjs } = await loadCanvasAndPdfjs();
  const fileBuffer = await fs.readFile(filePath);
  const key = crypto.createHash("sha256").update(fileBuffer).update(`dpi=${LOCAL_OCR_TARGET_DPI}`).digest("hex").slice(0, 32);
  const checkpointDir = path.join(CHECKPOINT_ROOT, key);
  await sweepStaleCheckpoints();
  await fs.mkdir(checkpointDir, { recursive: true });

  const bin = await findTesseractBinary();
  const concurrency = Math.max(1, os.availableParallelism());
  let pool = null;
  let pdf = null;

  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      password: password || undefined,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    }).promise;
    const totalPages = pdf.numPages;
    if (!bin) pool = await createTesseractJsPool(concurrency);
    const ocr = bin ? (imagePath) => ocrImageNative(bin, imagePath) : (imagePath) => pool.ocr(imagePath);
    logs.push({
      level: "info",
      stage: "ocr",
      message: `Local OCR (${bin ? "native tesseract" : "tesseract.js"}, ${concurrency} worker(s), ${LOCAL_OCR_TARGET_DPI} DPI) started for ${totalPages} page(s).`,
    });

    const pages = new Array(totalPages);
    const skippedPages = [];
    let finished = 0;
    const pageDone = () => onProgress?.({ page: (finished += 1), totalPages });
    const inFlight = new Set();
    const scale = LOCAL_OCR_TARGET_DPI / PDF_POINTS_PER_INCH;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const checkpointPath = path.join(checkpointDir, `page-${pageNumber}.json`);
      const saved = await fs.readFile(checkpointPath, "utf8").then(JSON.parse, () => null);
      if (saved) {
        pages[pageNumber - 1] = saved;
        pageDone();
        continue;
      }

      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const textWords = await readTextLayerWords(page, pdfjs, viewport);
      if (textWords.reduce((sum, word) => sum + word.text.length, 0) >= MIN_TEXT_LAYER_CHARS) {
        page.cleanup();
        pages[pageNumber - 1] = { pageNumber, source: "text", words: textWords };
        await fs.writeFile(checkpointPath, JSON.stringify(pages[pageNumber - 1]));
        pageDone();
        continue;
      }

      while (inFlight.size >= concurrency) await Promise.race(inFlight);
      const imagePath = path.join(checkpointDir, `page-${pageNumber}.pgm`);
      const pageStart = Date.now();
      await renderPageToPgm(page, canvasApi, viewport, imagePath);
      page.cleanup();

      const task = ocr(imagePath)
        .catch(() => ocr(imagePath))
        .then(
          async (words) => {
            pages[pageNumber - 1] = { pageNumber, source: "ocr", words, durationMs: Date.now() - pageStart };
            await fs.writeFile(checkpointPath, JSON.stringify(pages[pageNumber - 1]));
          },
          (error) => {
            const reason = error?.message || String(error);
            skippedPages.push({ pageNumber, reason });
            logs.push({ level: "warn", stage: "ocr", message: `Page ${pageNumber} skipped: ${reason}` });
            pages[pageNumber - 1] = { pageNumber, source: "ocr", words: [] };
          },
        )
        .finally(() => {
          inFlight.delete(task);
          pageDone();
          return fs.rm(imagePath, { force: true });
        });
      inFlight.add(task);
    }
    await Promise.all(inFlight);

    const resultPages = pages.map((entry) => ({ ...entry, lines: buildLinesFromWordBoxes(entry.words, entry.pageNumber) }));
    const lines = resultPages.flatMap((entry) => entry.lines);
    logs.push({
      level: "info",
      stage: "ocr",
      message:
        `Local extraction finished: ${resultPages.filter((entry) => entry.source === "text").length} text-layer page(s), ` +
        `${resultPages.filter((entry) => entry.source === "ocr").length} OCR'd page(s)` +
        (skippedPages.length ? `, skipped: ${skippedPages.map((entry) => entry.pageNumber).join(", ")}` : "") +
        ".",
      pagesProcessed: totalPages,
      durationMs: Date.now() - start,
    });

    return {
      pageCount: totalPages,
      pages: resultPages,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      source: "ocr",
      ocrDpi: LOCAL_OCR_TARGET_DPI,
      skippedPages,
      logs,
    };
  } finally {
    await pool?.terminate().catch(() => {});
    await pdf?.destroy().catch(() => {});
    await fs.rm(checkpointDir, { recursive: true, force: true });
  }
}

async function extractScannedFile(filePath, password, { onProgress } = {}) {
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

  if (ext === ".pdf" && (pageCount > REMOTE_OCR_MAX_PAGES || !getOcrApiKey())) {
    const result = await extractPdfLocally(filePath, { password, onProgress });
    await fs.writeFile(cachePath, JSON.stringify(result), "utf8").catch(() => {});
    return result;
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

export { extractScannedFile, extractPdfLocally, parseTesseractTsv, splitPdfPages, requestOcr, buildLinesFromParsedResult };
