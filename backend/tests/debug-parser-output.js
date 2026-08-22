import fs from "node:fs/promises";
import { parseColumnarOcrStatement } from "../src/parsers/ocrColumnarParser.js";

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const result = parseColumnarOcrStatement(ocrData.lines);
  const octTxns = result.transactions.filter(t => t.date && t.date.toISOString().slice(0, 7) === "2025-10");
  
  console.log(`Found ${octTxns.length} raw October transactions:`);
  octTxns.forEach((t, i) => {
    console.log(`${i+1}: Date: ${t.date.toISOString().slice(0, 10)}, Narration: ${t.particulars.slice(0, 50)}, Withdrawal: ${t.withdrawal}, Deposit: ${t.deposit}, Balance: ${t.balance}`);
  });
}

main().catch(console.error);
