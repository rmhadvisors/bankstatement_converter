import { readdirSync } from "node:fs";
import { extractPdf } from "../src/parsers/pdfExtractor.js";

async function main() {
  const files = readdirSync("tmp").filter(f => f.endsWith(".pdf"));
  console.log("PDF files in tmp:", files);
  
  for (const file of files) {
    const path = `tmp/${file}`;
    try {
      const ext = await extractPdf(path);
      console.log(`File: ${file}, Pages: ${ext.pageCount}, Text Length: ${ext.text ? ext.text.length : 0}`);
      if (ext.text && (ext.text.includes("6700") || ext.text.includes("Aarti") || ext.text.includes("Khar"))) {
        console.log(`FOUND MATCH in ${file}!`);
      }
    } catch (e) {
      console.error(`Error reading ${file}:`, e.message);
    }
  }
}

main().catch(console.error);
