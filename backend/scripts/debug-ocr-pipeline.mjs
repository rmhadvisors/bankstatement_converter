// One-off diagnostic script: runs the REAL scanned PDF through the REAL production pipeline
// (real OCR calls, real reconstruction code, real parser, real Excel writer) and dumps the
// intermediate artifact at each stage so we can find exactly where merged-transaction rows first
// appear. No transcription, no simulated OCR -- this hits the actual OCR path(s) with the actual
// file, exactly as converter.js does for a real upload.
import process from "node:process";
try {
  process.loadEnvFile();
} catch (e) {
  // Ignored if loadEnvFile doesn't exist or .env is missing
}

import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

import { extractScannedFile, requestOcr } from "../src/parsers/ocrExtractor.js";
import { groupIntoBlocks } from "../src/parsers/ocrTransactionReconstructor.js";
import {
  isFinacleTransactionInquiryLayout,
  parseFinacleTransactions,
  HEADER_FOOTER_PATTERNS,
  TERMINAL_PATTERNS,
} from "../src/parsers/parsers/finacleOcrParser.js";
import { detectBank } from "../src/parsers/parsers/detector.js";
import { parseStatement } from "../src/parsers/parser.js";
import { buildWorkbookBuffer } from "../src/parsers/excelWriter.js";

const OUT_DIR = path.join(process.cwd(), "debug-artifacts");
const PDF_PATH = path.join(OUT_DIR, "IDBI BANK_0001.pdf");

const DATE_ANYWHERE = /\b\d{2}[/.-]\d{2}[/.-]\d{2,4}\b/g;
const countDates = (text) => [...String(text || "").matchAll(DATE_ANYWHERE)].length;

// Replicates runLocalPdfOcr's own rendering+recognize steps exactly (same scale, same call),
// purely to CAPTURE what production discards: it only keeps `result.data.text`, never
// `result.data.words` (Tesseract's own word bounding boxes). We record both here as evidence.
async function runLocalTesseractWithFullData(fileBuffer) {
  const canvasApi = await import("@napi-rs/canvas");
  const { tmpdir } = await import("node:os");
  const cachePath = path.join(tmpdir(), "statement-savior-tesseract");
  await fs.mkdir(cachePath, { recursive: true });
  globalThis.Path2D = canvasApi.Path2D;
  globalThis.DOMMatrix = canvasApi.DOMMatrix;
  globalThis.ImageData = canvasApi.ImageData;

  const [Tesseract, pdfjs] = await Promise.all([
    import("tesseract.js").then((m) => m.default || m),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer), verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 300 / 72 });
    const canvas = canvasApi.createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const png = await canvas.encode("png");
    console.log(`  Running local Tesseract OCR on page ${pageNumber}/${pdf.numPages}...`);
    const result = await Tesseract.recognize(png, "eng", { cachePath });
    pages.push({
      pageNumber,
      rawText: result.data.text,
      wordCount: result.data.words?.length ?? 0,
      firstFewWords: (result.data.words || []).slice(0, 5).map((w) => ({
        text: w.text,
        bbox: w.bbox,
        confidence: w.confidence,
      })),
    });
  }

  return pages;
}

async function main() {
  const fileBuffer = await fs.readFile(PDF_PATH);
  console.log("File size:", fileBuffer.length, "bytes");

  // ===== Reproduce production's own OCR.space attempt first, to see exactly why/whether it
  // falls back (converter.js -> extractScannedFile -> requestOcr, same code, same file). =====
  let ocrSpaceFailure = null;
  try {
    await requestOcr({ fileBuffer, fileName: "IDBI BANK_0001.pdf", mimeType: "application/pdf", ext: ".pdf" });
    console.log("OCR.space succeeded (unexpected based on earlier run -- re-check).");
  } catch (error) {
    ocrSpaceFailure = { message: error.message, code: error.code, status: error.status };
    console.log("OCR.space attempt failed (as production would experience):", ocrSpaceFailure);
  }

  // ===== STAGE 1: raw OCR engine output. Since OCR.space rejects this file outright, production
  // (converter.js -> ocrExtractor.js's extractScannedFile) silently falls back to local
  // Tesseract.js OCR with NO word bounding boxes captured -- only flattened page text. =====
  console.log("Running local Tesseract fallback (same rendering/recognize steps as production)...");
  const localOcrPages = await runLocalTesseractWithFullData(fileBuffer);
  await fs.writeFile(
    path.join(OUT_DIR, "01_raw_ocr.json"),
    JSON.stringify({ ocrSpaceFailure, localTesseractPages: localOcrPages }, null, 2),
  );
  for (const page of localOcrPages) {
    console.log(
      `Stage 1 page ${page.pageNumber}: wordCount(from Tesseract, not used downstream)=${page.wordCount}, ` +
        `rawText lines=${page.rawText.split(/\r?\n/).filter(Boolean).length}, dates-in-rawText=${countDates(page.rawText)}`,
    );
  }

  // ===== Now run the ACTUAL production function end to end for stages 2-4, so stage 2 exactly
  // matches what converter.js/parser.js would receive for a real upload of this file. =====
  console.log("\nCalling extractScannedFile() -- the exact function converter.js calls...");
  const extraction = await extractScannedFile(PDF_PATH);
  await fs.writeFile(path.join(OUT_DIR, "02_reconstructed_rows.json"), JSON.stringify(extraction.lines, null, 2));
  console.log("Stage 2 saved. Lines:", extraction.lines.length);
  console.log("extraction.logs:", JSON.stringify(extraction.logs, null, 2));

  const linesWithMultipleDates = extraction.lines.filter((line) => countDates(line.text) >= 2);
  console.log("Stage 2 lines containing 2+ dates:", linesWithMultipleDates.length, "of", extraction.lines.length);
  if (linesWithMultipleDates.length) {
    console.log("Example stage-2 multi-date line:", JSON.stringify(linesWithMultipleDates[0], null, 2));
  }

  // ===== STAGE 3: transaction blocks, using the exact patterns finacleOcrParser.js uses. =====
  const detectedFormat = detectBank(extraction.text || extraction.lines);
  const isFinacleLayout = isFinacleTransactionInquiryLayout(extraction.lines);
  console.log("\ndetectBank() result:", detectedFormat);
  console.log("isFinacleTransactionInquiryLayout() result:", isFinacleLayout);

  const blocks = groupIntoBlocks(extraction.lines, {
    headerFooterPatterns: HEADER_FOOTER_PATTERNS,
    terminalPatterns: TERMINAL_PATTERNS,
  });
  const blocksSerialized = blocks.map((block) => ({
    lines: block.lines,
    joinedText: block.lines.join(" "),
    dateCount: countDates(block.lines.join(" ")),
    hadCorrections: block.hadCorrections,
  }));
  await fs.writeFile(path.join(OUT_DIR, "03_transaction_blocks.json"), JSON.stringify(blocksSerialized, null, 2));
  console.log("Stage 3 saved. Blocks:", blocks.length);
  const blocksWithMultipleDates = blocksSerialized.filter((b) => b.dateCount > 2);
  console.log("Stage 3 blocks with >2 dates (likely merged rows):", blocksWithMultipleDates.length);
  if (blocksWithMultipleDates.length) {
    console.log("Example stage-3 merged block:", JSON.stringify(blocksWithMultipleDates[0], null, 2));
  }

  const parsingErrors = [];
  const reviewRows = [];
  const directTransactions = parseFinacleTransactions(extraction.lines, { parsingErrors, reviewRows });
  console.log("parseFinacleTransactions() directly: transactions=", directTransactions.length, "reviewRows=", reviewRows.length);

  const statement = parseStatement(extraction);
  console.log("\nparseStatement() detectedFormat:", statement.detectedFormat);
  console.log("parseStatement() transactions:", statement.transactions.length);
  console.log("parseStatement() reviewRows:", (statement.reviewRows || []).length);

  // ===== STAGE 4: what actually lands in the Excel file =====
  const buffer = statement.accounts
    ? null
    : await buildWorkbookBuffer(statement);
  if (buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheetName = wb.worksheets.some((s) => s.name === "BANK STATEMENT") ? "BANK STATEMENT" : wb.worksheets[0].name;
    const sheet = wb.getWorksheet(sheetName);
    const excelRows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      excelRows.push(row.values.slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)));
    });
    await fs.writeFile(
      path.join(OUT_DIR, "04_excel_rows.json"),
      JSON.stringify({ sheetName, header: sheet.getRow(1).values.slice(1), rows: excelRows }, null, 2),
    );
    console.log("Stage 4 saved. Excel sheet:", sheetName, "rows:", excelRows.length);
  }

  console.log("\nDone. Artifacts written to:", OUT_DIR);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
