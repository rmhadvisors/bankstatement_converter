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
  
  // Try sending the first page to OCR.Space with isTable = false
  console.log("Sending page 1 to OCR.Space with isTable=false...");
  const ocrApiKey = process.env.OCR_SPACE_API_KEY;
  const form = new FormData();
  form.append("apikey", ocrApiKey);
  form.append("language", "eng");
  form.append("isTable", "false"); // Note the false here!
  form.append("OCREngine", "2");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("filetype", "PDF");
  form.append("file", new Blob([pages[0].fileBuffer], { type: "application/pdf" }), pages[0].fileName);

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  const results = payload.ParsedResults || [];
  
  console.log("OCR.Space page 1 results success!");
  console.log("Result text preview:\n", results[0]?.ParsedText);
}

main().catch(console.error);
