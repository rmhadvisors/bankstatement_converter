import process from "node:process";
try {
  process.loadEnvFile();
} catch (e) {}

import { convertPdfToStatement } from "../src/parsers/converter.js";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  console.log("Starting conversion on the uploaded PDF...");
  
  const statement = await convertPdfToStatement(pdfPath, { scanned: true });
  console.log("SUCCESS!");
  console.log("Detected Format:", statement.detectedFormat);
  console.log("Transactions extracted count:", statement.transactions.length);
  console.log("Reconciliation status:", statement.reconciliation.status);
  
  console.log("\nFirst 15 Transactions:");
  for (let i = 0; i < Math.min(statement.transactions.length, 15); i++) {
    const t = statement.transactions[i];
    console.log(`${i+1}: Date: ${t.date.toISOString().slice(0, 10)}, Narration: ${t.particulars.slice(0, 50)}, Withdrawal: ${t.withdrawal}, Deposit: ${t.deposit}, Balance: ${t.balance}`);
  }
}

main().catch(console.error);
