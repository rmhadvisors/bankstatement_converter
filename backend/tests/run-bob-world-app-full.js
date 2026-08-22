import fs from "node:fs/promises";
import { convertPdfToExcelFile, convertPdfToStatement } from "../src/parsers/converter.js";

async function main() {
  const pdfPath = "tests/fixtures/BOB__2360__APRIL_TO_JUN.pdf";
  const statement = await convertPdfToStatement(pdfPath);

  console.log("Detected format:", statement.detectedFormat);
  console.log("Transaction count:", statement.transactions.length);
  console.log("Reconciliation:", JSON.stringify(statement.reconciliation, null, 2));

  const outPath = "tests/fixtures/BOB__2360__APRIL_TO_JUN-converted.xlsx";
  await convertPdfToExcelFile(pdfPath, outPath);
  console.log("\nWrote Excel to:", outPath);

  // CSV export
  const rows = statement.transactions.map((t) => ({
    serialNo: t.serialNo ?? "",
    date: t.date ? t.date.toISOString().slice(0, 10) : "",
    valueDate: t.valueDate ? t.valueDate.toISOString().slice(0, 10) : "",
    particulars: t.particulars,
    chequeNo: t.chequeNo ?? "",
    withdrawal: t.withdrawal ?? "",
    deposit: t.deposit ?? "",
    balance: t.balance ?? "",
  }));

  const header = "SerialNo,TransactionDate,ValueDate,Description,ChequeNo,Debit,Credit,Balance";
  const csvLines = [header];
  for (const r of rows) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    csvLines.push(
      [r.serialNo, r.date, r.valueDate, esc(r.particulars), r.chequeNo, r.withdrawal, r.deposit, r.balance].join(","),
    );
  }
  await fs.writeFile("tests/fixtures/BOB__2360__APRIL_TO_JUN-converted.csv", csvLines.join("\n"), "utf8");
  console.log("Wrote CSV to: tests/fixtures/BOB__2360__APRIL_TO_JUN-converted.csv");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
