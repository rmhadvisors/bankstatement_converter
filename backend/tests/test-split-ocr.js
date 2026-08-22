import process from "node:process";
try {
  process.loadEnvFile();
} catch (e) {}

import { splitPdfPages, requestOcr } from "../src/parsers/ocrExtractor.js";
import fs from "node:fs/promises";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  const fileBuffer = await fs.readFile(pdfPath);
  
  console.log("Splitting PDF pages...");
  const pages = await splitPdfPages(fileBuffer, "media__1782811280625.pdf");
  console.log("Total pages split:", pages.length);
  
  // Try sending the first page to OCR.Space
  console.log("Sending page 1 to OCR.Space...");
  const results = await requestOcr({
    fileBuffer: pages[0].fileBuffer,
    fileName: pages[0].fileName,
    mimeType: "application/pdf",
    ext: ".pdf"
  });
  
  console.log("OCR.Space page 1 results success!");
  console.log("Result text preview:\n", results[0]?.ParsedText?.slice(0, 500));
}

main().catch(console.error);
