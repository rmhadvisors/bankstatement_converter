import { extractPdf } from "../src/parsers/pdfExtractor.js";

async function main() {
  const pdfPath = "C:/Users/HP/Downloads/BOI BANK.pdf";
  const ext = await extractPdf(pdfPath);
  console.log("Lines length:", ext.lines.length);
  console.log("Text length:", ext.text ? ext.text.length : 0);
  console.log("Raw text snippet:", JSON.stringify(ext.text ? ext.text.slice(0, 500) : ""));
}

main().catch(console.error);
