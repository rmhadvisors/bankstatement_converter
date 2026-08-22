import fs from "node:fs/promises";
import { parseStatement } from "../src/parsers/parser.js";
import { isBankOfBarodaLayout, parseBankOfBarodaTransactions } from "../src/parsers/bobParser.js";

async function main() {
  const cachePath = "tests/fixtures/BOB__2360__APRIL_TO_JUN.pdf.ocr.json";
  console.log("Loading OCR data from:", cachePath);
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  console.log("Total pages:", ocrData.pageCount);
  console.log("Total lines:", ocrData.lines.length);
  
  console.log("\nisBankOfBarodaLayout(ocrData.lines):", isBankOfBarodaLayout(ocrData.lines));
  
  console.log("\nParsing transactions via parseBankOfBarodaTransactions directly...");
  try {
    const txns = parseBankOfBarodaTransactions(ocrData.lines);
    console.log("Parsed count:", txns.length);
    if (txns.length > 0) {
      console.log("First 3 transactions:");
      console.log(txns.slice(0, 3));
    }
  } catch (err) {
    console.error("Direct parse failed:", err);
  }

  console.log("\nParsing via parseStatement...");
  try {
    const result = parseStatement(ocrData);
    console.log("Success! Parser detected format:", result.detectedFormat);
    console.log("Transactions found:", result.transactions.length);
    if (result.transactions.length > 0) {
      console.log("First 3 transactions from parseStatement:");
      console.log(result.transactions.slice(0, 3));
    }
    console.log("Reconciliation summary:");
    console.log(JSON.stringify(result.reconciliation, null, 2));
  } catch (err) {
    console.error("parseStatement failed:", err);
  }
}

main().catch(console.error);
