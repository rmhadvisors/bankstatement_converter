import ExcelJS from "exceljs";

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile("d:/CA-RMHStaffPortal/BankStatementconvertermain/FY-2025-2026-Converted.xlsx");
  const sheet = workbook.getWorksheet(1) || workbook.worksheets[0];
  
  let txnRows = 0;
  let totalRows = 0;
  sheet.eachRow((row, rowNumber) => {
    totalRows++;
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    // A transaction row is a row where the first column is a date string or Date object
    const firstVal = values[0];
    const secondVal = values[1];
    
    // Check if it's a date or looks like a transaction row
    const isDate = firstVal instanceof Date || (typeof firstVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(firstVal));
    const isSpecial = secondVal && /Opening Balance|Closing Balance/i.test(String(secondVal));
    
    if (isDate && !isSpecial) {
      txnRows++;
      console.log(`Row ${rowNumber}: Date=${firstVal.toISOString ? firstVal.toISOString().slice(0, 10) : firstVal}, Narration=${secondVal.slice(0, 40)}, Withdrawal=${values[2]}, Deposit=${values[3]}, Balance=${values[4]}`);
    }
  });
  
  console.log(`\nTotal rows in Excel sheet: ${totalRows}`);
  console.log(`Total transaction rows: ${txnRows}`);
}

main().catch(console.error);
