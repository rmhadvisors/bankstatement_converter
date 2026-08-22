import ExcelJS from "exceljs";

async function main() {
  const filePath = "FY-2025-2026-Converted.xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("Extracted Transactions");
  console.log(`Extracted Transactions rows: ${sheet.rowCount}`);
  for (let i = 1; i <= Math.min(sheet.rowCount, 60); i++) {
    const row = sheet.getRow(i);
    const values = [];
    for (let c = 1; c <= 6; c++) {
      values.push(row.getCell(c).value);
    }
    console.log(`Row ${i}:`, JSON.stringify(values));
  }
}

main().catch(console.error);
