import fs from "node:fs/promises";
import { convertPdfToStatement } from "../src/parsers/converter.js";
import { findBalanceBreaks } from "../src/parsers/validation.js";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  const statement = await convertPdfToStatement(pdfPath, { scanned: true });
  
  const edge = statement.transactions[0];
  const openingBalance = edge.balance + edge.withdrawal - edge.deposit;
  
  const breaks = findBalanceBreaks(statement.transactions, openingBalance);
  console.log("Balance breaks found:", breaks.length);
  breaks.forEach((b) => {
    console.log(`Row ${b.rowNumber}: Date=${b.date.toISOString().slice(0, 10)}, expected=${b.expectedBalance}, actual=${b.actualBalance}, diff=${b.difference}`);
    console.log(`  Particulars: "${b.particulars}"`);
  });
}

main().catch(console.error);
