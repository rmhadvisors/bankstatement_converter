import fs from "node:fs/promises";
import { parseAxisOcrPage } from "../src/parsers/ocrColumnarParser.js";

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const pageLines = ocrData.pages[1].lines; // Page 2 is index 1
  const lastKnownDate = new Date(Date.UTC(2025, 3, 29)); // April 29
  const lastClosingBalance = 278.45;
  
  const txns = parseAxisOcrPage(pageLines, lastKnownDate, lastClosingBalance);
  console.log(`Page 2 returned ${txns.length} transactions:`);
  txns.forEach((t, i) => {
    console.log(`${i+1}: Date: ${t.date ? t.date.toISOString().slice(0, 10) : null}, Narration: ${t.particulars.slice(0, 50)}, Withdrawal: ${t.withdrawal}, Deposit: ${t.deposit}, Balance: ${t.balance}`);
  });
}

main().catch(console.error);
