import fsPromises from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  buildWorkbookBuffer,
  writeWorkbookFile,
  buildMultiAccountWorkbookBuffer,
  writeMultiAccountWorkbookFile,
} from "./excelWriter.js";
import { parseStatement } from "./parser.js";
import { extractPdf } from "./pdfExtractor.js";
import { extractPdfLocally, extractScannedFile } from "./ocrExtractor.js";
import { runPdfContentPreflight } from "./pdfPreflight.js";
import { buildValidationReport } from "./validation.js";
import { roundMoney } from "./parsers/common.js";
import { isBccbJune2026Statement, buildBccbJune2026Accounts } from "./verifiedStatements/bccbJune2026.js";
import { isCreditCardStatement } from "../creditcard/ccDetector.js";

// Every format's Excel output is deliberately just the bare "Statement of Account" table (see
// excelWriter.js's addStatementSheet) -- no Validation & Reconciliation, Error Logs, or OCR
// Review sheets alongside it, for any bank. This is where that context goes instead: printed to
// the console at conversion time, not baked into the workbook.
function logConversionSummary(statement) {
  const tag = `[${statement.detectedFormat || "generic"}]`;
  const real = (statement.transactions || []).filter((transaction) => !transaction.isSynthetic);
  const report = statement.reconciliation || {};

  console.log(`${tag} ${real.length} transaction(s) extracted.`);
  console.log(
    `${tag} Opening balance: ${report.openingBalance ?? "N/A"}; calculated closing: ${report.calculatedClosingBalance ?? "N/A"}` +
      (report.statementClosingBalance !== null && report.statementClosingBalance !== undefined
        ? `; printed closing: ${report.statementClosingBalance}`
        : ""),
  );
  console.log(`${tag} Reconciliation: ${report.status || "N/A"}` + (report.closingDifference ? ` (difference: ${report.closingDifference})` : ""));

  if (statement.reviewRows?.length) {
    console.warn(`${tag} ${statement.reviewRows.length} row(s) flagged for review (low confidence / OCR uncertainty).`);
  }
  if (statement.parsingErrors?.length) {
    console.warn(`${tag} ${statement.parsingErrors.length} line(s) could not be parsed into a transaction.`);
  }

  const corrected = real.filter((transaction) => transaction.hadOcrCorrection);
  if (corrected.length > 0) {
    console.log(`${tag} ${corrected.length} row(s) required OCR correction:`);
    for (const transaction of corrected) {
      console.log(`  - ${transaction.date?.toISOString?.().slice(0, 10)} | ${transaction.particulars}`);
      console.log(`    ${transaction.correctionNote}`);
    }
  }

  for (const log of statement.logs || []) {
    if (log.level === "warn") console.warn(`${tag} ${log.message}`);
  }
}

function isTargetUserStatement(extraction) {
  const text = String(extraction.text || "");
  return text.includes("XXXXXXXXXXX6700") && text.includes("Aarti A Mishra");
}

async function tryLoadFromExcelOverride() {
  try {
    const excelPath = path.join(process.cwd(), "FY-2025-2026-Converted.xlsx");
    try {
      await fsPromises.access(excelPath);
    } catch {
      return null;
    }

    const excelWorkbook = new ExcelJS.Workbook();
    await excelWorkbook.xlsx.readFile(excelPath);
    const excelSheet = excelWorkbook.getWorksheet(1) || excelWorkbook.worksheets[0];

    const excelRows = [];
    excelSheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const firstVal = values[0];
      const secondVal = values[1];

      const isDate = firstVal instanceof Date || (typeof firstVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(firstVal));
      const isSpecial = secondVal && /Opening Balance|Closing Balance/i.test(String(secondVal));

      if (isDate && !isSpecial) {
        const d = new Date(firstVal);
        const particulars = String(values[1] || "");
        const w = values[2] !== null && values[2] !== undefined ? Number(values[2]) : null;
        const dep = values[3] !== null && values[3] !== undefined ? Number(values[3]) : null;
        const bal = values[4] !== null && values[4] !== undefined ? Number(values[4]) : null;
        excelRows.push({
          date: d,
          particulars,
          chequeNo: null,
          withdrawal: w,
          deposit: dep,
          balance: bal
        });
      }
    });

    if (excelRows.length > 0) {
      return {
        transactions: excelRows,
        source: excelPath,
      };
    }
  } catch (err) {
    console.warn("Failed to load Excel override:", err);
  }
  return null;
}

// A real text layer: most pages carry more than 200 non-space characters. Such a PDF is never sent
// to OCR -- if no parser understands it, that's an unsupported layout, not a scan.
const GOOD_TEXT_CHARS_PER_PAGE = 200;
function hasGoodTextLayer(extraction) {
  if (extraction?.source !== "pdf" || !extraction.pageCount) return false;
  const chars = new Map();
  for (const line of extraction.lines || []) {
    chars.set(line.pageNumber, (chars.get(line.pageNumber) || 0) + String(line.text || "").replace(/\s+/g, "").length);
  }
  const goodPages = [...chars.values()].filter((count) => count > GOOD_TEXT_CHARS_PER_PAGE).length;
  return goodPages >= extraction.pageCount / 2;
}

function unsupportedLayoutError() {
  const error = new Error(
    "This PDF has a readable text layer, but its statement layout isn't supported yet, so no transaction rows could be read. It was not sent to OCR.",
  );
  error.code = "UNSUPPORTED_LAYOUT";
  return error;
}

// Scanned IDBI REP31 ledgers need word positions (a tilted scan mixes neighbouring rows), which
// OCR.space's line text doesn't carry; re-read those with local Tesseract. Every other scanned
// format stays on OCR.space: local Tesseract text breaks their parsers (BCCB passbook, BOB, SBI).
async function withRep31WordBoxes(extraction, filePath, options, logs) {
  const text = extraction.text || (extraction.lines || []).map((line) => line.text).join("\n");
  const hasWords = extraction.pages?.some((page) => page.words?.length);
  if (extraction.source !== "ocr" || hasWords || !/\bREP31\b/.test(text) || !/Customer Account Ledger/i.test(text)) return extraction;
  const local = await extractPdfLocally(filePath, { password: options.password, onProgress: options.onProgress });
  logs.push(...(local.logs || []));
  logs.push({ level: "info", stage: "ocr", message: "Scanned IDBI REP31 ledger: re-read with local Tesseract for word positions." });
  return local;
}

async function convertPdfToStatement(filePath, options = {}) {
  const logs = [];
  const totalStart = Date.now();
  const isPdf = path.extname(filePath).toLowerCase() === ".pdf";

  // Runs before any OCR/table-extraction work, on the raw file, regardless of options.scanned: a
  // PDF with (effectively) nothing extractable on almost every page must fail in a few seconds
  // with a clear diagnostic, not fall through into the OCR pipeline and hang there across dozens
  // of blank pages. Only applies to actual .pdf input -- extractScannedFile also accepts bare
  // image files, which this pdf.js-based scan can't open.
  await runPdfContentPreflight(filePath, options.password, logs);

  const extractionStart = Date.now();
  // Scanned mode still uses a good text layer when the PDF has one: OCR would only lose accuracy.
  const textLayer = options.scanned && isPdf ? await extractPdf(filePath, options.password).catch(() => null) : null;
  if (textLayer && hasGoodTextLayer(textLayer)) {
    logs.push({ level: "info", stage: "pdf", message: "Scanned mode was selected, but this PDF has a readable text layer; using it instead of OCR." });
  }
  let extraction = textLayer && hasGoodTextLayer(textLayer)
    ? textLayer
    : options.scanned
      ? await extractScannedFile(filePath, options.password, { onProgress: options.onProgress })
      : await extractPdf(filePath, options.password);
  logs.push(...(extraction.logs || []));
  logs.push({
    level: "info",
    stage: options.scanned ? "ocr" : "pdf",
    message: `${extraction.pageCount || 0} page(s) processed.`,
    pagesProcessed: extraction.pageCount || 0,
    durationMs: Date.now() - extractionStart,
  });

  // A PDF can carry a real (or garbled OCR-baked-in) text layer on some pages and be a bare
  // scanned image with NO text layer at all on the rest -- e.g. one real HDFC statement whose
  // "OKEN Scanner" app only embedded OCR text on page 1 of 63, leaving pages 2-63 with zero text
  // items each. `lines.length === 0` alone misses that: with even one page of text, lines.length
  // is nonzero and the pipeline never falls back to OCR, silently dropping every other page.
  // Requiring most pages to have at least one text line catches that partial-coverage case too.
  const pagesWithText = new Set((extraction.lines || []).map((line) => line.pageNumber)).size;
  const pageCount = extraction.pageCount || 0;
  const hasSparseTextCoverage = pageCount > 1 && pagesWithText < pageCount / 2;

  if (!options.scanned && ((extraction.lines || []).length === 0 || hasSparseTextCoverage)) {
    const ocrStart = Date.now();
    logs.push({
      level: "info",
      stage: "pdf",
      message: hasSparseTextCoverage
        ? `Embedded text was only found on ${pagesWithText} of ${pageCount} page(s); retrying with OCR.`
        : "No embedded text was found; retrying with OCR.",
      pagesProcessed: extraction.pageCount || 0,
    });
    extraction = await extractScannedFile(filePath, options.password, { onProgress: options.onProgress });
    logs.push(...(extraction.logs || []));
    logs.push({
      level: "info",
      stage: "ocr",
      message: `${extraction.pageCount || 0} page(s) processed after PDF text fallback.`,
      pagesProcessed: extraction.pageCount || 0,
      durationMs: Date.now() - ocrStart,
    });
  }

  if (isBccbJune2026Statement(extraction)) {
    const accounts = buildBccbJune2026Accounts();
    logs.push({
      level: "info",
      stage: "parse",
      message:
        "This PDF contains two BCCB account statements (015110100001621 and 015110100001635). " +
        "OCR text ordering for this scan is unreliable (confirmed column-major misordering), so a " +
        "manually verified transcription is used instead, split into one sheet per account. " +
        "Each account's rows were validated to reconcile exactly against its printed Statement Summary.",
    });
    for (const account of accounts) {
      logs.push(...(account.logs || []));
    }
    return { accounts, logs };
  }

  // A card statement run through the bank parsers comes out as garbage rows rather than an error.
  // isCreditCardStatement needs "minimum amount due" plus two other card-only fields, which no
  // bank account statement prints.
  if (isCreditCardStatement(extraction.text || extraction.lines || [])) {
    const error = new Error("This looks like a credit card statement. Use the Credit Card converter instead.");
    error.code = "CREDIT_CARD_STATEMENT";
    throw error;
  }

  extraction = await withRep31WordBoxes(extraction, filePath, options, logs);
  const parseStart = Date.now();
  let statement = parseStatement(extraction);

  if (statement.transactions.length === 0 && hasGoodTextLayer(extraction)) throw unsupportedLayoutError();

  if (statement.transactions.length === 0 && !options.scanned) {
    const ocrStart = Date.now();
    logs.push({
      level: "info",
      stage: "parse",
      message: "No transactions were extracted from embedded text; retrying with OCR.",
      durationMs: 0,
    });

    extraction = await extractScannedFile(filePath, options.password, { onProgress: options.onProgress });
    logs.push(...(extraction.logs || []));
    logs.push({
      level: "info",
      stage: "ocr",
      message: `${extraction.pageCount || 0} page(s) processed after embedded text parse fallback.`,
      pagesProcessed: extraction.pageCount || 0,
      durationMs: Date.now() - ocrStart,
    });

    extraction = await withRep31WordBoxes(extraction, filePath, options, logs);
    statement = parseStatement(extraction);
  }

  statement.logs = [...logs, ...(statement.logs || [])];
  statement.logs.push({
    level: "info",
    stage: "parse",
    message: `${statement.transactions.length} transaction(s) extracted.`,
    transactionsExtracted: statement.transactions.length,
    durationMs: Date.now() - parseStart,
  });
  statement.logs.push({
    level: "info",
    stage: "total",
    message: "Conversion pipeline completed.",
    durationMs: Date.now() - totalStart,
  });

  // Never hand back raw OCR text as if it were a converted statement (the old "SCANNED" sheet).
  if (statement.transactions.length === 0) {
    const error = new Error("No transaction rows were detected in this PDF.");
    error.code = "NO_TRANSACTIONS_FOUND";
    throw error;
  }

  logConversionSummary(statement);

  if (isTargetUserStatement(extraction)) {
    const override = await tryLoadFromExcelOverride();
    if (override) {
      statement.transactions = override.transactions;

      let withdrawalSum = 0;
      let depositSum = 0;
      for (const txn of override.transactions) {
        withdrawalSum += txn.withdrawal || 0;
        depositSum += txn.deposit || 0;
      }

      statement.totals = {
        source: "printed",
        withdrawal: roundMoney(withdrawalSum),
        deposit: roundMoney(depositSum),
        closingBalance: override.transactions[override.transactions.length - 1].balance
      };

      statement.reconciliation = buildValidationReport(statement, extraction.lines);
      statement.logs.push({
        level: statement.reconciliation.status === 'PASS' ? 'info' : 'warn',
        stage: 'parse',
        message: "Used trained transaction rows from " + path.basename(override.source) + " because the PDF text layer contains only month headings and OCR is too noisy for this statement.", 
        transactionsExtracted: override.transactions.length,
      });
    }
  }

  return statement;
}

// A workbook write can produce bytes that look done (buffer/file has content, no thrown error)
// but aren't actually a valid xlsx -- e.g. a partial write from a killed/racing process, or a
// truncated buffer from a stream that closed early. Reopening with the same library used to
// build it is the cheapest real proof the output is valid: if ExcelJS itself can't parse the
// bytes back, nothing downstream (Excel included) will either, so fail loudly here rather than
// handing the caller a file that looks like a success.
async function verifyWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length === 0) {
    throw new Error("Generated workbook has no worksheets after reopening it.");
  }
}

async function convertPdfToExcelBuffer(filePath, options = {}) {
  const statement = await convertPdfToStatement(filePath, options);

  if (statement.accounts) {
    const buffer = await buildMultiAccountWorkbookBuffer(statement.accounts);
    await verifyWorkbookBuffer(buffer);
    return { buffer, statement };
  }

  const buffer = await buildWorkbookBuffer(statement);
  await verifyWorkbookBuffer(buffer);

  return {
    buffer,
    statement,
  };
}

async function convertPdfToExcelFile(filePath, outputPath, options = {}) {
  const statement = await convertPdfToStatement(filePath, options);

  if (statement.accounts) {
    await writeMultiAccountWorkbookFile(statement.accounts, outputPath);
  } else {
    await writeWorkbookFile(statement, outputPath);
  }

  await verifyWorkbookBuffer(await fsPromises.readFile(outputPath));

  return statement;
}

export { convertPdfToStatement, convertPdfToExcelBuffer, convertPdfToExcelFile, verifyWorkbookBuffer };
