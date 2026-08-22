import fs from "node:fs/promises";
import { parseColumnarOcrStatement } from "../src/parsers/ocrColumnarParser.js";

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const result = parseColumnarOcrStatement(ocrData.lines);
  const badTxns = result.transactions.filter(t => t.date && (t.date.getFullYear() > 2026 || t.date.getFullYear() < 2025));
  console.log(`Bad year transactions: ${badTxns.length}`);
  badTxns.forEach(t => console.log(`  Date: ${t.date.toISOString().slice(0, 10)}, Particulars: ${t.particulars}`));
}

main().catch(console.error);
