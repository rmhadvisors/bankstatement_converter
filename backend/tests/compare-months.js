import ExcelJS from "exceljs";
import { convertPdfToStatement } from "../src/parsers/converter.js";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  const statement = await convertPdfToStatement(pdfPath, { scanned: true });
  
  const excelWorkbook = new ExcelJS.Workbook();
  await excelWorkbook.xlsx.readFile("d:/CA-RMHStaffPortal/BankStatementconvertermain/FY-2025-2026-Converted.xlsx");
  const excelSheet = excelWorkbook.getWorksheet(1) || excelWorkbook.worksheets[0];
  
  const excelMonthCounts = {};
  excelSheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    const firstVal = values[0];
    const secondVal = values[1];
    
    const isDate = firstVal instanceof Date || (typeof firstVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(firstVal));
    const isSpecial = secondVal && /Opening Balance|Closing Balance/i.test(String(secondVal));
    
    if (isDate && !isSpecial) {
      const d = new Date(firstVal);
      const monthKey = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      excelMonthCounts[monthKey] = (excelMonthCounts[monthKey] || 0) + 1;
    }
  });
  
  const extractedMonthCounts = {};
  for (const t of statement.transactions) {
    if (t.date) {
      const monthKey = t.date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      extractedMonthCounts[monthKey] = (extractedMonthCounts[monthKey] || 0) + 1;
    }
  }
  
  console.log("Month-by-month Comparison (Excel vs Extracted):");
  console.log("Month      | Excel | Extracted");
  console.log("-----------|-------|-----------");
  const allMonths = new Set([...Object.keys(excelMonthCounts), ...Object.keys(extractedMonthCounts)]);
  for (const m of Array.from(allMonths).sort((a,b) => new Date(a) - new Date(b))) {
    console.log(`${m.padEnd(10)} | ${(excelMonthCounts[m] || 0).toString().padStart(5)} | ${(extractedMonthCounts[m] || 0).toString().padStart(9)}`);
  }
}

main().catch(console.error);
