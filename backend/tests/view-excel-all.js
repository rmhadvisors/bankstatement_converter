import ExcelJS from "exceljs";

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile("d:/CA-RMHStaffPortal/BankStatementconvertermain/FY-2025-2026-Converted.xlsx");
  const sheet = workbook.getWorksheet(1) || workbook.worksheets[0];
  
  for (let rowNumber = 48; rowNumber <= 60; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    console.log(`Row ${rowNumber}: ${JSON.stringify(values)}`);
  }
}

main().catch(console.error);
