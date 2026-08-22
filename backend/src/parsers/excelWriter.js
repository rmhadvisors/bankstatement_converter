import ExcelJS from "exceljs";
import fsPromises from "node:fs/promises";
import { roundMoney, isChronological } from "./parsers/common.js";

function setWorkbookMetadata(workbook) {
  workbook.creator = "Bank Statement Convertor";
  workbook.created = new Date();
  workbook.modified = new Date();
}

function styleHeader(row) {
  row.height = 23.25;
  row.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      family: 2,
      scheme: "minor",
      bold: true,
      size: 18,
      color: { argb: "FF000000" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      left: { style: "thin" },
      right: { style: "thin" },
      top: { style: "thin" },
      bottom: { style: "thin" },
    };
  });
}

function styleTotalRow(row) {
  row.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF000000" } };
  row.eachCell((cell) => {
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      left: { style: "thin" },
      right: { style: "thin" },
      top: { style: "thin" },
      bottom: { style: "thin" },
    };
    if (!cell.font) {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
    }
  });
}

function autoFitColumns(sheet, minimumWidth = 10, maximumWidth = 60) {
  sheet.columns.forEach((column) => {
    let width = column.header ? String(column.header).length + 2 : minimumWidth;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const raw = cell.value instanceof Date ? "00-00-0000" : cell.text || cell.value;
      width = Math.max(width, String(raw || "").length + 2);
    });
    column.width = Math.min(Math.max(width, minimumWidth), maximumWidth);
  });
}

function addRawLinesSheet(workbook, rawLines) {
  const sheet = workbook.addWorksheet("SCANNED");
  sheet.columns = [{ header: "RAW OCR TEXT", key: "text", width: 120 }];
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const line of rawLines) {
    sheet.addRow({ text: line });
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });
  });
}

function getCalculatedTotals(transactions) {
  const totals = transactions.reduce(
    (result, transaction) => {
      result.withdrawal += Number(transaction.withdrawal || 0);
      result.deposit += Number(transaction.deposit || 0);
      return result;
    },
    { withdrawal: 0, deposit: 0, closingBalance: null },
  );

  if (transactions.length > 0) {
    const chronological = isChronological(transactions);
    const orderedNewestLast = chronological ? transactions : [...transactions].reverse();
    // The very last row's own balance can be null on a badly-OCR'd statement (a run of rows the
    // OCR-tolerant parser couldn't reconcile against any later known-good anchor at all -- see
    // ocrTransactionReconstructor.js/federalOcrParser.js's own "best-effort" fallback). Walking
    // backward to the nearest row that DOES have a balance is what a human reading the sheet would
    // do too, rather than reporting no closing balance at all when a perfectly good one is one row
    // away.
    for (let index = orderedNewestLast.length - 1; index >= 0; index -= 1) {
      const balance = orderedNewestLast[index].balance;
      if (balance !== null && balance !== undefined) {
        totals.closingBalance = balance;
        break;
      }
    }
  }

  return {
    source: "calculated",
    withdrawal: roundMoney(totals.withdrawal),
    deposit: roundMoney(totals.deposit),
    closingBalance: totals.closingBalance === null ? null : roundMoney(totals.closingBalance),
  };
}

function getTotals(statement) {
  const transactions = statement.transactions || [];
  const calculated = getCalculatedTotals(transactions);
  const printed = statement.printedTotals;

  if (printed && (printed.withdrawal !== null || printed.deposit !== null || printed.closingBalance !== null)) {
    return {
      source: "printed",
      withdrawal:
        printed.withdrawal !== null ? roundMoney(printed.withdrawal) : calculated.withdrawal,
      deposit: printed.deposit !== null ? roundMoney(printed.deposit) : calculated.deposit,
      closingBalance:
        printed.closingBalance !== null ? roundMoney(printed.closingBalance) : calculated.closingBalance,
    };
  }

  if (statement.totals?.source === "printed") {
    return statement.totals;
  }

  return calculated;
}

function addTransactionsSheet(workbook, transactions, totals, sheetName = "Extracted Transactions") {
  const sheet = workbook.addWorksheet(sheetName);
  // hadOcrCorrection only exists on rows that went through a tolerant OCR-reconstruction parser
  // (e.g. federalOcrParser.js) that had to derive a balance and/or amount from the balance chain
  // rather than read it directly -- surfaced as its own column only when that's actually relevant,
  // so a normal clean-PDF conversion's sheet isn't cluttered with an always-blank column.
  const hasCorrectionData = transactions.some((transaction) => transaction.hadOcrCorrection !== undefined);

  sheet.columns = [
    { header: "Date", key: "date", width: 12.57 },
    { header: "Description", key: "particulars", width: 36 },
    { header: "Debit", key: "withdrawal", width: 18 },
    { header: "Credit", key: "deposit", width: 18 },
    { header: "Balance", key: "balance", width: 18 },
    ...(hasCorrectionData
      ? [
          { header: "OCR Corrected", key: "hadOcrCorrection", width: 14 },
          { header: "Correction Note", key: "correctionNote", width: 60 },
        ]
      : []),
  ];

  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = hasCorrectionData ? "A1:G1" : "A1:E1";

  for (const transaction of transactions) {
    sheet.addRow({
      date: transaction.date,
      particulars: transaction.particulars,
      withdrawal: transaction.withdrawal,
      deposit: transaction.deposit,
      balance: transaction.balance,
      ...(hasCorrectionData
        ? {
            hadOcrCorrection: transaction.hadOcrCorrection ? "Yes" : "",
            correctionNote: transaction.correctionNote || "",
          }
        : {}),
    });
  }

  const totalRow = sheet.addRow({
    date: null,
    particulars: "GRAND TOTAL",
    withdrawal: totals.withdrawal,
    deposit: totals.deposit,
    balance: totals.closingBalance,
  });

  sheet.getColumn("date").numFmt = "dd-mm-yyyy";
  for (const key of ["withdrawal", "deposit", "balance"]) {
    sheet.getColumn(key).numFmt = '#,##0.00;[Red]-#,##0.00;"-"';
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });
  });

  styleTotalRow(totalRow);
  autoFitColumns(sheet, 12, 70);
}

function formatDDMMYYYY(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${date.getUTCFullYear()}`;
}

// Finacle "Transaction Inquiry" screens (used by IDBI and other banks as a scanned/printed
// core-banking export -- see finacleOcrParser.js) carry account metadata as a label/value block
// above the table rather than a bank's own printed statement header, so this builds a normal
// "Statement of Account" sheet from that metadata plus the parsed transactions, rather than the
// bare transaction dump the other Finacle path used.
// Exactly one sheet, exactly these 10 columns plus a trailing GRAND TOTAL row, no title/account-info
// block, no companion sheets -- for every bank format. Anything else worth surfacing about the
// conversion (detected format, transaction count, reconciliation, low-confidence rows, OCR
// corrections) goes to the console instead -- see logConversionSummary, called from converter.js --
// not into the workbook.
function addStatementSheet(workbook, statement) {
  const sheet = workbook.addWorksheet("Statement of Account");
  const transactions = (statement.transactions || []).filter((transaction) => !transaction.isSynthetic);

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    "Date",
    "Value Date",
    "Particulars / Description",
    "Tran Type",
    "Tran ID",
    "Cheque Details",
    "Withdrawals (INR)",
    "Deposits (INR)",
    "Balance (INR)",
    "Type",
  ];
  styleHeader(headerRow);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:J1";

  for (const transaction of transactions) {
    sheet.addRow([
      formatDDMMYYYY(transaction.date),
      formatDDMMYYYY(transaction.valueDate || transaction.date),
      transaction.particulars,
      transaction.tranType || "",
      transaction.chequeNo || "",
      transaction.chequeDetails || "",
      transaction.withdrawal,
      transaction.deposit,
      transaction.balance,
      // No direction-based guess here: a parser that didn't capture the source's own printed
      // Cr/Dr suffix for this row has no reliable signal for Type at all (a debit row's own
      // balance is routinely still printed "Cr"), so leaving it blank is correct, not a gap.
      transaction.type || "",
    ]);
  }

  const totals = getTotals({ transactions, printedTotals: statement.printedTotals });
  const totalRow = sheet.addRow([
    "",
    "",
    "GRAND TOTAL",
    "",
    "",
    "",
    totals.withdrawal,
    totals.deposit,
    totals.closingBalance,
    "",
  ]);

  const widths = [12, 12, 42, 10, 12, 14, 16, 16, 16, 8];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (const column of ["G", "H", "I"]) {
    sheet.getColumn(column).numFmt = '#,##0.00;[Red]-#,##0.00;"-"';
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });
  });

  styleTotalRow(totalRow);
}

// For a PDF containing multiple statements (one per account), build one
// "Extracted Transactions" sheet per account plus a single reconciliation sheet
// that reports the pass/fail check for every account, and one shared error log.
function addMultiAccountSummarySheet(workbook, accountStatements) {
  const sheet = workbook.addWorksheet("Validation & Reconciliation");
  sheet.columns = [
    { header: "ACCOUNT", key: "account", width: 28 },
    { header: "CHECK", key: "check", width: 30 },
    { header: "CALCULATED", key: "calculated", width: 18 },
    { header: "STATEMENT PRINTED", key: "printed", width: 18 },
    { header: "STATUS", key: "status", width: 10 },
  ];
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:E1";

  for (const account of accountStatements) {
    const totals = getTotals(account);
    const printed = account.printedTotals || {};
    const label = `${account.accountTitle || ""} (${account.accountNo || ""})`.trim();

    const rows = [
      ["Transactions Extracted", account.transactions.length, printed.debitCount != null && printed.creditCount != null ? printed.debitCount + printed.creditCount : "", ""],
      ["Opening Balance", account.openingBalance ?? "N/A", printed.openingBalance ?? "N/A", ""],
      ["Total Debits", totals.withdrawal, printed.totalDebit ?? "N/A", ""],
      ["Total Credits", totals.deposit, printed.totalCredit ?? "N/A", ""],
      ["Closing Balance", totals.closingBalance, printed.closingBalance ?? "N/A", ""],
    ];

    for (const [check, calculated, printedValue, _unused] of rows) {
      const numericPrinted = typeof printedValue === "number" ? printedValue : null;
      const status =
        numericPrinted === null || typeof calculated !== "number"
          ? ""
          : Math.abs(calculated - numericPrinted) < 0.01
            ? "PASS"
            : "FAIL";
      sheet.addRow({ account: label, check, calculated, printed: printedValue, status });
    }
  }

  for (const key of ["calculated", "printed"]) {
    sheet.getColumn(key).numFmt = '#,##0.00;[Red]-#,##0.00;"-"';
  }

  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    if (rowNumber === 1) styleHeader(row);
  });
  autoFitColumns(sheet, 12, 45);
}

async function buildMultiAccountWorkbookBuffer(accountStatements) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);

  for (const account of accountStatements) {
    const acctTail = String(account.accountNo || "").slice(-4);
    const title = (account.accountTitle || account.accountNo || "Account").slice(0, 23);
    const sheetName = `${title} ..${acctTail}`.slice(0, 31);
    addTransactionsSheet(workbook, account.transactions, getTotals(account), sheetName);
  }

  addMultiAccountSummarySheet(workbook, accountStatements);
  addLogsSheet(workbook, accountStatements.flatMap((account) => account.logs || []));

  return workbook.xlsx.writeBuffer();
}

async function writeMultiAccountWorkbookFile(accountStatements, outputPath) {
  const buffer = await buildMultiAccountWorkbookBuffer(accountStatements);
  await fsPromises.writeFile(outputPath, buffer);
}

function addLogsSheet(workbook, logs = []) {
  const sheet = workbook.addWorksheet("Error Logs");
  sheet.columns = [
    { header: "LEVEL", key: "level", width: 12 },
    { header: "STAGE", key: "stage", width: 18 },
    { header: "MESSAGE", key: "message", width: 70 },
    { header: "ROW", key: "rowNumber", width: 10 },
    { header: "DURATION MS", key: "durationMs", width: 14 },
    { header: "DETAILS", key: "details", width: 50 },
  ];
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:F1";

  for (const log of logs) {
    sheet.addRow({
      level: log.level || "",
      stage: log.stage || "",
      message: log.message || "",
      rowNumber: log.rowNumber || "",
      durationMs: log.durationMs || "",
      details: log.transaction || log.difference || "",
    });
  }

  if (logs.length === 0) {
    sheet.addRow({
      level: "info",
      stage: "validation",
      message: "No errors or warnings were recorded.",
    });
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });
  });

  autoFitColumns(sheet, 10, 80);
}

// Every bank format shares one output shape: exactly one "Statement of Account" sheet, exactly
// the 10 columns addStatementSheet writes, nothing else -- no per-format sheet variants, no
// validation/logs/review/parsing-errors sheets alongside it. The only exception is a statement
// that produced zero transactions at all (nothing to put in that sheet), which falls back to a
// raw-OCR-text dump instead so a failed conversion isn't silently an empty file.
function populateStatementWorkbook(workbook, statement) {
  if (statement.transactions.length === 0 && Array.isArray(statement.rawLines)) {
    addRawLinesSheet(workbook, statement.rawLines);
    return;
  }

  addStatementSheet(workbook, statement);
}

async function buildWorkbookBuffer(statement) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  populateStatementWorkbook(workbook, statement);
  return workbook.xlsx.writeBuffer();
}

async function writeWorkbookFile(statement, outputPath) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  populateStatementWorkbook(workbook, statement);

  // Log mismatch to console if printed totals differ from calculated totals
  if (statement && statement.printedTotals) {
    const calc = getCalculatedTotals(statement.transactions || []);
    const printed = statement.printedTotals;
    const withdrawDiff = Math.abs((calc.withdrawal || 0) - (printed.withdrawal || 0));
    const depositDiff = Math.abs((calc.deposit || 0) - (printed.deposit || 0));
    const closingDiff =
      calc.closingBalance !== null && printed.closingBalance !== null
        ? Math.abs(calc.closingBalance - printed.closingBalance)
        : 0;
    if (withdrawDiff > 0.01 || depositDiff > 0.01 || closingDiff > 0.01) {
      console.warn("Printed totals differ from calculated totals:", {
        withdrawDiff,
        depositDiff,
        closingDiff,
      });
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}

export {
  buildWorkbookBuffer,
  writeWorkbookFile,
  buildMultiAccountWorkbookBuffer,
  writeMultiAccountWorkbookFile,
};
