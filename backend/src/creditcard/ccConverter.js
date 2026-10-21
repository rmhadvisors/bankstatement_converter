import path from "node:path";
import { runPdfContentPreflight } from "../parsers/pdfPreflight.js";
import { extractPdf } from "../parsers/pdfExtractor.js";
import { extractScannedFile } from "../parsers/ocrExtractor.js";
import { verifyWorkbookBuffer } from "../parsers/converter.js";
import { linesToText } from "./ccCommon.js";
import { classifyStatement, detectIssuer } from "./ccDetector.js";
import { checkRunningBalance, reconcile, removeDuplicateRows } from "./ccValidation.js";
import { buildCreditCardWorkbookBuffer } from "./ccExcelWriter.js";
import { isHdfcCardLayout, parseHdfcCard } from "./issuers/hdfcCard.js";
import { isIciciCardLayout, parseIciciCard } from "./issuers/iciciCard.js";
import { isSbiCardLayout, parseSbiCard } from "./issuers/sbiCard.js";
import { isAxisCardLayout, parseAxisCard } from "./issuers/axisCard.js";
import { isGenericCardLayout, parseGenericCard } from "./issuers/genericCard.js";

const ISSUER_PARSERS = [
  { isLayout: isHdfcCardLayout, parse: parseHdfcCard },
  { isLayout: isIciciCardLayout, parse: parseIciciCard },
  { isLayout: isSbiCardLayout, parse: parseSbiCard },
  { isLayout: isAxisCardLayout, parse: parseAxisCard },
  { isLayout: isGenericCardLayout, parse: parseGenericCard },
];

function ccError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// pdf.js throws PasswordException with a numeric code (1 = needs password, 2 = wrong password)
// from the preflight, before extractPdf gets a chance to map it.
function asPasswordError(error) {
  if (
    error?.name === "PasswordException" ||
    error?.code === "PASSWORD_REQUIRED" ||
    error?.code === "INVALID_PASSWORD"
  ) {
    const wrong = error.code === 2 || error.code === "INVALID_PASSWORD";
    return wrong
      ? ccError(
          "WRONG_PASSWORD",
          "The PDF password is incorrect. Card statement passwords are often the first 4 letters of your name plus your birth date (DDMM).",
        )
      : ccError(
          "PASSWORD_REQUIRED",
          "This statement is password protected. Enter its password and try again.",
        );
  }
  return error;
}

async function extractCardText(filePath, password) {
  if (path.extname(filePath).toLowerCase() !== ".pdf") return extractScannedFile(filePath);

  let extraction;
  try {
    await runPdfContentPreflight(filePath, password);
    extraction = await extractPdf(filePath, password);
  } catch (error) {
    throw asPasswordError(error);
  }

  const pagesWithText = new Set(extraction.lines.map((line) => line.pageNumber)).size;
  if (extraction.lines.length > 0 && pagesWithText >= extraction.pageCount / 2) return extraction;

  // TODO: OCR for password-protected scans. ocrExtractor splits pages with pdf-lib, which cannot
  // decrypt. pdf.js can: open with { password }, render each page to an @napi-rs/canvas canvas
  // (as ocrExtractor's runLocalPdfOcr already does for unencrypted PDFs) and OCR those images.
  if (password) {
    throw ccError(
      "ENCRYPTED_SCAN_UNSUPPORTED",
      "This statement is a password-protected scanned PDF, which can't be OCR'd yet. Remove the password (print to PDF) and upload it again.",
    );
  }
  return extractScannedFile(filePath);
}

async function convertCreditCardStatement(filePath, { password = "" } = {}) {
  const extraction = await extractCardText(filePath, password);
  return buildCardStatement(extraction.lines || [], extraction.text);
}

// Everything after text extraction: classify, parse, de-duplicate, verify, reconcile. Separate so
// tests can feed it extracted (redacted) lines without the PDF.
function buildCardStatement(lines, text = linesToText(lines)) {
  const kind = classifyStatement(text);
  if (kind !== "credit_card") {
    throw ccError(
      "NOT_A_CREDIT_CARD_STATEMENT",
      kind === "bank"
        ? "This looks like a bank account statement, not a credit card statement. Use the Bank Statement converter instead."
        : "This doesn't look like a credit card statement: no minimum amount due, payment due date or credit limit was found.",
    );
  }

  const issuer = detectIssuer(text);
  const parser = ISSUER_PARSERS.find((candidate) => candidate.isLayout(lines));
  const { summary, transactions, emiSummary } = parser.parse(lines);

  if (transactions.length === 0) {
    throw issuer
      ? ccError(
          "NO_TRANSACTIONS_FOUND",
          `No transactions could be read from this ${issuer.name} credit card statement.`,
        )
      : ccError(
          "UNSUPPORTED_ISSUER",
          "This card issuer isn't supported yet and no transactions could be read from the statement.",
        );
  }

  summary.issuer = issuer?.name ?? null;
  const deduped = removeDuplicateRows(transactions);
  // Before reconcile: the running balance may correct Debit/Credit types that totals depend on.
  const runningBalance = checkRunningBalance(summary, deduped.transactions);
  return {
    summary,
    transactions: deduped.transactions,
    emiSummary,
    duplicatesRemoved: deduped.removed,
    reconciliation: reconcile(summary, deduped.transactions, runningBalance),
  };
}

async function convertCreditCardToExcelBuffer(filePath, options = {}) {
  const statement = await convertCreditCardStatement(filePath, options);
  const buffer = await buildCreditCardWorkbookBuffer(statement);
  await verifyWorkbookBuffer(buffer);
  return { buffer, statement };
}

export { buildCardStatement, convertCreditCardStatement, convertCreditCardToExcelBuffer };
