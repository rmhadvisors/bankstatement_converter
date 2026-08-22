import fs from "node:fs/promises";
import { extractScannedFile } from "../src/parsers/ocrExtractor.js";
import { isSbiOcrLayout, parseSbiOcrTransactions } from "../src/parsers/parsers/sbiOcrParser.js";

function roundMoney(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

async function main() {
  const pdfPath = "tests/fixtures/SBI_2025-26_organized.pdf";
  const extraction = await extractScannedFile(pdfPath);
  const layoutDetected = isSbiOcrLayout(extraction.lines);
  const { transactions, openingBalance } = parseSbiOcrTransactions(extraction.lines);

  const mismatches = [];
  for (let i = 1; i < transactions.length; i++) {
    const row = transactions[i];
    const prev = transactions[i - 1];
    if (row.balance === null || prev.balance === null) continue;
    const expected = roundMoney(prev.balance - (row.withdrawal || 0) + (row.deposit || 0));
    const actual = roundMoney(row.balance);
    if (Math.abs(expected - actual) > 0.02) {
      mismatches.push({
        index: i + 1,
        pageNumber: row.pageNumber,
        date: row.date ? row.date.toISOString().slice(0, 10) : "",
        particulars: row.particulars,
        expectedBalance: expected,
        actualBalance: actual,
        difference: roundMoney(actual - expected),
      });
    }
  }

  const unparsed = transactions.filter((r) => !r.isOpeningBalance && (!r.date || r.balance === null));

  // CSV
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = "Index,Page,PostDate,ValueDate,Description,ChequeNoReference,Debit,Credit,Balance";
  const csvLines = [header];
  transactions.forEach((r, i) => {
    csvLines.push(
      [
        i + 1,
        r.pageNumber,
        r.date ? r.date.toISOString().slice(0, 10) : "",
        r.valueDate ? r.valueDate.toISOString().slice(0, 10) : "",
        esc(r.particulars),
        r.chequeNo ?? "",
        r.withdrawal ?? "",
        r.deposit ?? "",
        r.balance ?? "",
      ].join(","),
    );
  });
  await fs.writeFile("tests/fixtures/SBI_2025-26-converted.csv", csvLines.join("\n"), "utf8");

  // Summary report
  const totalDebit = transactions.reduce((sum, r) => sum + (r.withdrawal || 0), 0);
  const totalCredit = transactions.reduce((sum, r) => sum + (r.deposit || 0), 0);
  const lastBalance = transactions.length ? transactions[transactions.length - 1].balance : null;

  const report = [];
  report.push("SBI Statement Parsing Summary");
  report.push("==============================");
  report.push(`Source: ${pdfPath}`);
  report.push(`Layout detected: ${layoutDetected ? "bank-of-baroda-style OCR layout (sbi-ocr)" : "NOT DETECTED"}`);
  report.push(`Pages: ${extraction.pageCount}`);
  report.push(`Total transactions extracted: ${transactions.length}`);
  report.push(`Opening balance (BROUGHT FORWARD): ${openingBalance}`);
  report.push(`Closing balance (last row): ${lastBalance}`);
  report.push(`Total debits: ${roundMoney(totalDebit)}`);
  report.push(`Total credits: ${roundMoney(totalCredit)}`);
  report.push(`Rows failed to parse (missing date/balance): ${unparsed.length}`);
  report.push(`Rows failing balance reconciliation: ${mismatches.length} / ${transactions.length}`);
  report.push("");
  report.push("Balance mismatches (page, index, expected vs actual):");
  for (const m of mismatches) {
    report.push(
      `  page ${m.pageNumber}, row #${m.index} (${m.date}): expected ${m.expectedBalance}, got ${m.actualBalance}, diff ${m.difference} -- ${m.particulars.slice(0, 90)}`,
    );
  }
  if (unparsed.length > 0) {
    report.push("");
    report.push("Rows missing date or balance:");
    for (const r of unparsed) {
      report.push(`  page ${r.pageNumber}: ${r.particulars.slice(0, 90)}`);
    }
  }

  await fs.writeFile("tests/fixtures/SBI_2025-26-parsing-summary.txt", report.join("\n"), "utf8");

  console.log(report.join("\n"));
  console.log("\nWrote CSV to tests/fixtures/SBI_2025-26-converted.csv");
  console.log("Wrote summary to tests/fixtures/SBI_2025-26-parsing-summary.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
