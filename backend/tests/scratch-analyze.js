import { extractPdf } from "../src/parsers/pdfExtractor.js";
import { isBankOfBarodaLayout, parseBankOfBarodaTransactions } from "../src/parsers/bobParser.js";
import { parseStatement } from "../src/parsers/parser.js";
import path from "node:path";

async function main() {
  const pdfPath = "tests/fixtures/BOB__2360__APRIL_TO_JUN.pdf";
  console.log("Extracting PDF...");
  const extraction = await extractPdf(pdfPath);
  console.log("PDF page count:", extraction.pageCount);
  console.log("PDF total lines extracted:", extraction.lines.length);
  
  // Show first 100 lines for debugging
  console.log("\n--- FIRST 50 LINES ---");
  for (let i = 0; i < Math.min(50, extraction.lines.length); i++) {
    console.log(`${i}: page ${extraction.lines[i].pageNumber} (y=${extraction.lines[i].y}): "${extraction.lines[i].text}"`);
  }
  
  console.log("\nChecking isBankOfBarodaLayout...");
  const isBOB = isBankOfBarodaLayout(extraction.lines);
  console.log("isBankOfBarodaLayout:", isBOB);

  console.log("\nRunning parseStatement...");
  try {
    const result = parseStatement(extraction);
    console.log("Success! Transactions found:", result.transactions.length);
    console.log("Detected Format:", result.detectedFormat);
    console.log("Logs:", JSON.stringify(result.logs, null, 2));
    
    if (result.transactions.length > 0) {
      console.log("\nFirst 5 transactions:");
      for (let i = 0; i < Math.min(5, result.transactions.length); i++) {
        console.log(JSON.stringify(result.transactions[i]));
      }
      
      console.log("\nLast 5 transactions:");
      for (let i = Math.max(0, result.transactions.length - 5); i < result.transactions.length; i++) {
        console.log(JSON.stringify(result.transactions[i]));
      }
    }
  } catch (err) {
    console.error("Parser threw error:", err);
  }
}

main().catch(console.error);
