import { convertPdfToStatement } from "../src/parsers/converter.js";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  const statement = await convertPdfToStatement(pdfPath, { scanned: true });
  
  const septTxns = statement.transactions.filter(t => t.date.toISOString().slice(0, 7) === "2025-09");
  console.log(`Found ${septTxns.length} September transactions:`);
  septTxns.forEach((t, i) => {
    console.log(`${i+1}: Date: ${t.date.toISOString().slice(0, 10)}, Narration: ${t.particulars.slice(0, 50)}, Withdrawal: ${t.withdrawal}, Deposit: ${t.deposit}, Balance: ${t.balance}`);
  });
}

main().catch(console.error);
