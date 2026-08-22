import fs from "node:fs/promises";
import path from "node:path";

let pdfjsPromise;
function getPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

// Wall-clock budget for the WHOLE cheap content pre-check, not per page. A genuinely malformed or
// bloated PDF can make pdf.js's per-page text/operator-list calls take hundreds of milliseconds
// EACH even on a blank page (measured ~350-500ms/page on a real 82.7MB/85-page statement whose 84
// blank pages still dragged along huge orphaned internal objects unrelated to any page's content) --
// no page count is small enough to guarantee a *full* scan of such a file finishes quickly, so the
// scan itself is time-boxed and a confident verdict is drawn from however many pages it got through.
const PRECHECK_BUDGET_MS = 4500;
// Below this many sampled pages, a high empty-ratio is as likely to be sampling noise (e.g. a
// statement that happens to start with a couple of blank/cover pages) as a genuinely empty file.
const MIN_SAMPLE_PAGES = 8;
// Measured against the confirmed-bad fixture: only ~2 of the first 12 pages scanned within budget
// had any content (both images, on a file whose full 85 pages are 84 empty / 1 real) -- a strict
// 0.9+ threshold undershoots what a time-boxed partial sample can show, so this sits below the true
// full-file ratio (0.988) with headroom for a partial scan of a real file to still clear it.
const EMPTY_PAGE_RATIO_THRESHOLD = 0.75;
// Separate, stricter budget for just *opening* the document (xref parsing/recovery) -- this cost
// is independent of how much real image content the pages hold, so unlike the per-page scan
// budget above (which a legitimately large scanned statement can genuinely need more of), a slow
// open is a strong standalone signal of a malformed/bloated file structure and is safe to fail on
// by itself rather than needing corroborating emptiness evidence.
const OPEN_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function scanPageContent(pdf, pdfjs, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  try {
    const textContent = await page.getTextContent();
    const chars = textContent.items.reduce((sum, item) => sum + (item.str ? item.str.length : 0), 0);

    const operatorList = await page.getOperatorList();
    const hasImage = operatorList.fnArray.some(
      (fn) =>
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject ||
        fn === pdfjs.OPS.paintJpegXObject,
    );

    return { chars, hasImage };
  } finally {
    page.cleanup();
  }
}

function buildEmptyPdfError({ emptyCount, sampleSize, pageCount, totalChars, imagesFound, partial }) {
  const scope = partial
    ? `at least ${emptyCount} of the first ${sampleSize} page(s) scanned (${pageCount} total)`
    : `${emptyCount} of ${pageCount} page(s)`;
  const error = new Error(
    `This PDF appears to have no readable content on ${scope} ` +
      `(${totalChars} character(s) of text, ${imagesFound} image(s) found). The file may be ` +
      `corrupted or exported incorrectly -- please verify it displays correctly in a PDF viewer ` +
      `and re-export/re-download it if not.`,
  );
  error.code = "PDF_NO_READABLE_CONTENT";
  // Structured fields alongside the message so callers (the API route) can surface exact numbers
  // in the response body instead of having to regex them back out of prose.
  error.pagesScanned = sampleSize;
  error.totalPages = pageCount;
  error.emptyPages = emptyCount;
  error.imagesFound = imagesFound;
  return error;
}

function buildSlowOpenError({ fileSizeBytes, elapsedMs }) {
  const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
  const error = new Error(
    `This PDF (${sizeMb} MB) could not even be opened within ${(elapsedMs / 1000).toFixed(1)}s. ` +
      `Its internal structure appears bloated or malformed -- unusually slow to parse for its size -- ` +
      `so automatic conversion was stopped instead of continuing to hang. Please verify it displays ` +
      `correctly in a PDF viewer and re-export/re-download it if not.`,
  );
  error.code = "PDF_PREFLIGHT_OPEN_TOO_SLOW";
  return error;
}

// Fast content pre-check, run before any OCR/table-extraction work: iterates pages cheaply (native
// text + a quick check for embedded images), time-boxed so a pathological file fails fast with a
// clear diagnostic instead of silently falling through into the OCR pipeline and hanging there
// across dozens of effectively-blank pages.
async function runPdfContentPreflight(filePath, password, logs = []) {
  if (path.extname(filePath).toLowerCase() !== ".pdf") {
    return null;
  }

  const pdfjs = await getPdfjs();
  const stat = await fs.stat(filePath);
  const data = new Uint8Array(await fs.readFile(filePath));

  const openStart = Date.now();
  const pdf = await withTimeout(
    pdfjs.getDocument({ data, password: password || undefined, verbosity: pdfjs.VerbosityLevel.ERRORS }).promise,
    OPEN_TIMEOUT_MS,
    () => buildSlowOpenError({ fileSizeBytes: stat.size, elapsedMs: OPEN_TIMEOUT_MS }),
  );
  const pageCount = pdf.numPages;

  const scanStart = Date.now();
  let pagesWithContent = 0;
  let totalChars = 0;
  let imagesFound = 0;
  let scanned = 0;
  let timedOut = false;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (Date.now() - scanStart > PRECHECK_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const { chars, hasImage } = await scanPageContent(pdf, pdfjs, pageNumber);
    scanned += 1;
    totalChars += chars;
    if (hasImage) imagesFound += 1;
    if (chars > 0 || hasImage) pagesWithContent += 1;
  }

  const emptyCount = scanned - pagesWithContent;
  const emptyRatio = scanned > 0 ? emptyCount / scanned : 0;
  const elapsedMs = Date.now() - openStart;

  logs.push({
    level: "info",
    stage: "preflight",
    message:
      `Content pre-check scanned ${scanned}/${pageCount} page(s)` +
      (timedOut ? " (stopped early, over time budget)" : "") +
      `: ${pagesWithContent} with content, ${totalChars} character(s) of text, ${imagesFound} image(s).`,
    durationMs: elapsedMs,
  });

  const isConfidentlyEmpty =
    pageCount > 1 && scanned >= Math.min(MIN_SAMPLE_PAGES, pageCount) && emptyRatio >= EMPTY_PAGE_RATIO_THRESHOLD;

  if (isConfidentlyEmpty) {
    throw buildEmptyPdfError({
      emptyCount,
      sampleSize: scanned,
      pageCount,
      totalChars,
      imagesFound,
      partial: timedOut,
    });
  }

  // A scan that ran out of budget without showing confident emptiness is inconclusive, not
  // damning -- a legitimately large scanned statement (real image content on every page) can
  // genuinely take longer than this budget to decode, and that's an expected slow case the OCR
  // pipeline already handles, not a malformed file. Only the *open* step above is treated as a
  // hard, standalone timeout signal; here we just stop early and let normal processing continue.
  return { pageCount, pagesWithContent, totalChars, imagesFound, scanned, timedOut };
}

export { runPdfContentPreflight };
