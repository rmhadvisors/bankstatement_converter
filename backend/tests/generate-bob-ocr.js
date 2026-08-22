import fs from "node:fs/promises";
import path from "node:path";
import { extractScannedFile } from "../src/parsers/ocrExtractor.js";

async function main() {
  const pdfPath = "tests/fixtures/BOB__2360__APRIL_TO_JUN.pdf";
  console.log("Generating full OCR cache for:", pdfPath);
  const start = Date.now();
  
  const result = await extractScannedFile(pdfPath);
  
  console.log(`Full OCR completed in ${((Date.now() - start) / 1000).toFixed(2)} seconds.`);
  console.log("Pages extracted:", result.pageCount);
  console.log("Total lines:", result.lines.length);
}

main().catch(console.error);
