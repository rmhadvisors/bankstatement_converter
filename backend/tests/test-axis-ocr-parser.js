import process from "node:process";
try {
  process.loadEnvFile();
} catch (e) {}

import { extractScannedFile } from "../src/parsers/ocrExtractor.js";
import { clean } from "../src/parsers/parsers/common.js";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  const extraction = await extractScannedFile(pdfPath);
  
  const page4Lines = extraction.lines.filter(l => (l.pageNumber || 1) === 4);
  console.log(`Page 4 has ${page4Lines.length} lines.`);
  for (let i = 0; i < page4Lines.length; i++) {
    console.log(`${i}: ${clean(page4Lines[i].text)}`);
  }
}

main().catch(console.error);
