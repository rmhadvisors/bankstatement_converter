import ExcelJS from "exceljs";
import { maskCard, roundMoney } from "./ccCommon.js";

const FONT = "Arial";
const HEADER_FILL = "FF2F5F5F";
const STRIPE_FILL = "FFF2F7F7";
const WARNING_FILL = "FFFDE2E1";
const DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = "#,##0.00";
const BORDER = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const TXN_HEADER_ROW = 6;
const OPENING_ROW = TXN_HEADER_ROW + 1;

const hasPrintedBalance = (row) => row.balance !== null && row.balance !== undefined;

// Category and Details only appear when the statement has them. Balance is always there: the
// printed running balance when every row has one, otherwise computed ("Balance (computed)").
function txnColumns(transactions) {
  const printed = transactions.length > 0 && transactions.every(hasPrintedBalance);
  return [
    { header: "Date", key: "date", width: 12 },
    { header: "Description", key: "description", width: 48 },
    ...(transactions.some((row) => typeof row.category === "string")
      ? [{ header: "Category", key: "category", width: 18 }]
      : []),
    { header: "Ref No", key: "refNo", width: 18 },
    { header: "Card (last 4)", key: "card", width: 13 },
    { header: "Debit", key: "debit", width: 14 },
    { header: "Credit", key: "credit", width: 14 },
    { header: printed ? "Balance" : "Balance (computed)", key: "balance", width: 18 },
    { header: "Foreign Amt", key: "foreignAmount", width: 13 },
    { header: "Currency", key: "foreignCurrency", width: 10 },
    ...(transactions.some((row) => row.details)
      ? [{ header: "Details", key: "details", width: 60 }]
      : []),
  ];
}

// The statement's opening balance: printed previous balance, else back-computed from the first
// printed running balance, else 0.
function openingBalance(summary, transactions) {
  if (summary.previousBalance !== undefined) return summary.previousBalance;
  const first = transactions[0];
  if (first && hasPrintedBalance(first)) {
    return roundMoney(first.balance - (first.type === "credit" ? -first.amount : first.amount));
  }
  return 0;
}

const titleCase = (text) => text.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
  });
}

function styleBodyRow(row, index, columnCount) {
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = { name: FONT, ...(cell.font?.bold ? { bold: true } : {}) };
    cell.border = BORDER;
    if (index % 2 === 1)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE_FILL } };
  }
}

const formatDate = (date) =>
  date
    ? `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`
    : "";

function addTransactionsSheet(workbook, statement) {
  const { summary, transactions, reconciliation } = statement;
  const sheet = workbook.addWorksheet("Transactions");
  const TXN_COLUMNS = txnColumns(transactions);
  sheet.columns = TXN_COLUMNS.map(({ key, width }) => ({ key, width }));

  const period =
    summary.periodFrom || summary.periodTo
      ? `${formatDate(summary.periodFrom)} to ${formatDate(summary.periodTo)}`
      : "";
  const block = [
    summary.cardHolder || "",
    summary.cardProduct
      ? `${summary.issuer || "Unknown issuer"} ${titleCase(summary.cardProduct)}`
      : `${summary.issuer || "Unknown issuer"} Credit Card`,
    summary.cardLast4 ? `Card: ${maskCard(summary.cardLast4)}` : "Card: not found on statement",
    [
      period && `Statement Period: ${period}`,
      summary.statementDate && `Statement Date: ${formatDate(summary.statementDate)}`,
    ]
      .filter(Boolean)
      .join("   |   "),
  ];
  block.forEach((value, index) => {
    const cell = sheet.getCell(index + 1, 1);
    cell.value = value;
    cell.font = { name: FONT, bold: index < 2, size: index === 0 ? 14 : 11 };
  });

  if (reconciliation.status !== "OK") {
    sheet.mergeCells(5, 1, 5, TXN_COLUMNS.length);
    const cell = sheet.getCell(5, 1);
    cell.value = `WARNING: ${reconciliation.warnings.join(" ")} See the Summary sheet.`;
    cell.font = { name: FONT, bold: true, color: { argb: "FFC00000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNING_FILL } };
    cell.alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(5).height = 32;
  }

  const header = sheet.getRow(TXN_HEADER_ROW);
  header.values = TXN_COLUMNS.map((column) => column.header);
  styleHeaderRow(header);
  sheet.views = [{ state: "frozen", ySplit: TXN_HEADER_ROW }];
  sheet.autoFilter = {
    from: { row: TXN_HEADER_ROW, column: 1 },
    to: { row: TXN_HEADER_ROW, column: TXN_COLUMNS.length },
  };

  const letter = (key) =>
    String.fromCharCode(65 + TXN_COLUMNS.findIndex((column) => column.key === key));
  const [debitCol, creditCol, balanceCol] = ["debit", "credit", "balance"].map(letter);

  const opening = openingBalance(summary, transactions);
  const openingRow = sheet.addRow({
    description: "Opening Balance (Previous Balance)",
    balance: opening,
  });
  styleBodyRow(openingRow, 0, TXN_COLUMNS.length);
  openingRow.font = { name: FONT, bold: true };

  // A printed running balance is written as printed (and was checked row by row); otherwise each
  // row is previous balance + debit - credit, as a live formula with the value cached for viewers
  // that don't recalculate. (ExcelJS leaves out a cached result of exactly 0; Excel and LibreOffice
  // recalculate on open -- see fullCalcOnLoad.) Below 0 means the card is in credit.
  let running = opening;
  transactions.forEach((row, index) => {
    const rowNumber = OPENING_ROW + 1 + index;
    const debit = row.type === "debit" ? row.amount : null;
    const credit = row.type === "credit" ? row.amount : null;
    running = hasPrintedBalance(row)
      ? row.balance
      : roundMoney(running + (debit ?? 0) - (credit ?? 0));
    const added = sheet.addRow({
      date: row.date,
      description: row.description,
      category: row.category || "",
      refNo: row.refNo || "",
      card: row.cardLast4 || "",
      debit,
      credit,
      balance: hasPrintedBalance(row)
        ? row.balance
        : {
            formula: `${balanceCol}${rowNumber - 1}+${debitCol}${rowNumber}-${creditCol}${rowNumber}`,
            result: running,
          },
      foreignAmount: row.foreignAmount ?? null,
      foreignCurrency: row.foreignCurrency || "",
      details: row.details || "",
    });
    styleBodyRow(added, index + 1, TXN_COLUMNS.length);
    if (row.balanceBreak) {
      added.getCell("balance").font = { name: FONT, bold: true, color: { argb: "FFC00000" } };
    }
  });

  sheet.getColumn("date").numFmt = DATE_FORMAT;
  for (const { key } of TXN_COLUMNS.filter((column) =>
    ["debit", "credit", "balance", "foreignAmount"].includes(column.key),
  ))
    sheet.getColumn(key).numFmt = MONEY_FORMAT;
  for (const key of ["refNo", "card"]) sheet.getColumn(key).numFmt = "@";

  const first = OPENING_ROW + 1;
  const last = OPENING_ROW + Math.max(transactions.length, 1);
  return {
    debitRange: `Transactions!${debitCol}${first}:${debitCol}${last}`,
    creditRange: `Transactions!${creditCol}${first}:${creditCol}${last}`,
    dateRange: `Transactions!A${first}:A${last}`,
    closingCell: `Transactions!${balanceCol}${OPENING_ROW + transactions.length}`,
    closingValue: running,
  };
}

function addSummarySheet(workbook, statement, ranges) {
  const { summary, transactions, reconciliation } = statement;
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [{ width: 34 }, { width: 22 }, { width: 70 }];
  const header = sheet.addRow(["Field", "Value", "Note"]);
  styleHeaderRow(header);
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const rows = [];
  const add = (label, value, format, note = "") => {
    rows.push({ label, value, format, note });
    return rows.length + 1; // sheet row number (row 1 is the header)
  };

  add("Card Holder", summary.cardHolder || "");
  add("Issuer", summary.issuer || "Unknown issuer");
  if (summary.cardProduct) add("Card Product", titleCase(summary.cardProduct));
  add(
    "Card Number",
    summary.cardLast4 ? maskCard(summary.cardLast4) : "",
    null,
    "Only the last 4 digits are kept.",
  );
  add("Statement Date", summary.statementDate ?? null, DATE_FORMAT);
  add("Statement Period From", summary.periodFrom ?? null, DATE_FORMAT);
  add("Statement Period To", summary.periodTo ?? null, DATE_FORMAT);
  add("Payment Due Date", summary.paymentDueDate ?? null, DATE_FORMAT);
  const dueRow = add("Total Amount Due", summary.totalAmountDue ?? null, MONEY_FORMAT);
  add("Minimum Amount Due", summary.minimumAmountDue ?? null, MONEY_FORMAT);
  add("Credit Limit", summary.creditLimit ?? null, MONEY_FORMAT);
  add("Available Credit Limit", summary.availableCreditLimit ?? null, MONEY_FORMAT);
  add("Cash Limit", summary.cashLimit ?? null, MONEY_FORMAT);
  if (summary.availableCashLimit !== undefined) {
    add("Available Cash Limit", summary.availableCashLimit, MONEY_FORMAT);
  }
  const previousRow = add("Previous Balance", summary.previousBalance ?? null, MONEY_FORMAT);
  add("Payments / Credits (printed)", summary.paymentsCredits ?? null, MONEY_FORMAT);
  add("Purchases / Debits (printed)", summary.purchasesDebits ?? null, MONEY_FORMAT);
  // Only on layouts that print them (IDFC FIRST, Axis), so other layouts keep their row numbers.
  if (summary.otherDebits !== undefined)
    add("Other Debits & Charges (printed)", summary.otherDebits, MONEY_FORMAT);
  if (summary.cashAdvance !== undefined)
    add("Cash Advance (printed)", summary.cashAdvance, MONEY_FORMAT);
  if (summary.otherCredits !== undefined)
    add("Other Credits (printed)", summary.otherCredits, MONEY_FORMAT);
  const financeRow = add("Finance Charges (printed)", summary.financeCharges ?? null, MONEY_FORMAT);
  for (const [key, label] of [
    ["rewardPointsOpening", "Opening Reward Points"],
    ["rewardPointsEarned", "Reward Points Earned"],
    ["rewardPointsBonus", "Bonus Reward Points"],
    ["rewardPointsAdjusted", "Reward Points Adjusted"],
    ["rewardPointsClosing", "Closing Reward Points"],
  ]) {
    if (summary[key] !== undefined) add(label, summary[key], "#,##0");
  }
  if (summary.rewardPointsAsOf) add("Reward Points As On", summary.rewardPointsAsOf, DATE_FORMAT);
  add("", null);
  const debitsRow = add(
    "Total Debits (parsed)",
    { formula: `SUM(${ranges.debitRange})`, result: reconciliation.totalDebits },
    MONEY_FORMAT,
  );
  const creditsRow = add(
    "Total Credits (parsed)",
    { formula: `SUM(${ranges.creditRange})`, result: reconciliation.totalCredits },
    MONEY_FORMAT,
  );
  add(
    "Transaction Count",
    { formula: `COUNT(${ranges.dateRange})`, result: transactions.length },
    "0",
  );
  const due = summary.totalAmountDue;
  const closingDiff = due === undefined ? null : roundMoney(ranges.closingValue - due);
  add(
    "Closing Balance (last row)",
    { formula: ranges.closingCell, result: ranges.closingValue },
    MONEY_FORMAT,
    closingDiff === null
      ? "Total Amount Due not printed, so the closing balance can't be compared."
      : Math.abs(closingDiff) <= 1
        ? "Equals Total Amount Due (±1.00)."
        : `Differs from Total Amount Due by ${closingDiff.toFixed(2)}.`,
  );

  const charges = reconciliation.financeChargesAddedSeparately ? `+B${financeRow}` : "";
  const mainCheck = reconciliation.checks[0];
  const hasMainCheck =
    summary.previousBalance !== undefined && summary.totalAmountDue !== undefined;
  add(
    "Reconciliation Check",
    hasMainCheck
      ? {
          formula: `ROUND(B${previousRow}+B${debitsRow}-B${creditsRow}${charges}-B${dueRow},2)`,
          result: mainCheck.difference,
        }
      : "N/A",
    MONEY_FORMAT,
    "Previous Balance + Total Debits - Total Credits" +
      (charges ? " + Finance Charges" : "") +
      " - Total Amount Due. 0.00 = OK; within ±1.00 is rounding; anything else means rows are missing or misread.",
  );
  const chain = reconciliation.runningBalance;
  if (chain) {
    add(
      "Running Balance Check",
      chain.breaks.length === 0 ? "Verified" : `${chain.breaks.length} break(s)`,
      null,
      `Previous balance + debit - credit = printed balance, checked on all ${chain.checked} rows` +
        (chain.corrections.length
          ? `; ${chain.corrections.length} Debit/Credit type(s) corrected.`
          : "."),
    );
  }
  add("Reconciliation Status", reconciliation.status);
  if (statement.duplicatesRemoved) {
    add(
      "Duplicate Rows Removed",
      statement.duplicatesRemoved,
      "0",
      "Rows repeated across a page break.",
    );
  }
  reconciliation.warnings.forEach((warning, index) => add(index === 0 ? "Warnings" : "", warning));

  rows.forEach((row, index) => {
    const added = sheet.addRow([row.label, row.value, row.note]);
    if (row.format) added.getCell(2).numFmt = row.format;
    added.getCell(1).font = { bold: true };
    styleBodyRow(added, index, 3);
    added.getCell(3).alignment = { wrapText: true, vertical: "top" };
    if (row.label === "Reconciliation Status" && row.value !== "OK") {
      added.getCell(2).font = { name: FONT, bold: true, color: { argb: "FFC00000" } };
    }
  });
}

function addByCardSheet(workbook, transactions) {
  const groups = new Map();
  for (const row of transactions) {
    const key = `${row.cardHolder || ""}|${row.cardLast4 || ""}`;
    const group = groups.get(key) || {
      holder: row.cardHolder || "",
      last4: row.cardLast4 || "",
      count: 0,
      debits: 0,
      credits: 0,
    };
    group.count += 1;
    if (row.type === "credit") group.credits += row.amount;
    else group.debits += row.amount;
    groups.set(key, group);
  }
  if (groups.size < 2) return;

  const sheet = workbook.addWorksheet("By Card");
  sheet.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }];
  styleHeaderRow(
    sheet.addRow(["Card Holder", "Card (last 4)", "Transactions", "Debits", "Credits"]),
  );
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  [...groups.values()].forEach((group, index) => {
    const row = sheet.addRow([group.holder, group.last4, group.count, group.debits, group.credits]);
    row.getCell(4).numFmt = MONEY_FORMAT;
    row.getCell(5).numFmt = MONEY_FORMAT;
    styleBodyRow(row, index, 5);
  });
}

function addEmiSheet(workbook, emiSummary = []) {
  if (emiSummary.length === 0) return;
  const sheet = workbook.addWorksheet("EMI Summary");
  sheet.columns = [
    { width: 40 },
    { width: 10 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
  ];
  styleHeaderRow(
    sheet.addRow([
      "Merchant",
      "Tenure",
      "Original Principal",
      "Principal Paid",
      "Outstanding",
      "Monthly EMI",
    ]),
  );
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  emiSummary.forEach((emi, index) => {
    const row = sheet.addRow([
      emi.merchant,
      emi.tenure,
      emi.originalPrincipal,
      emi.principalPaid,
      emi.outstanding,
      emi.monthlyEmi,
    ]);
    for (let column = 3; column <= 6; column += 1) row.getCell(column).numFmt = MONEY_FORMAT;
    styleBodyRow(row, index, 6);
  });
}

async function buildCreditCardWorkbookBuffer(statement) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bank Statement Convertor";
  workbook.created = new Date();
  // ExcelJS drops a cached formula result of 0, so have Excel compute every formula on open.
  workbook.calcProperties.fullCalcOnLoad = true;
  const ranges = addTransactionsSheet(workbook, statement);
  addSummarySheet(workbook, statement, ranges);
  addByCardSheet(workbook, statement.transactions);
  addEmiSheet(workbook, statement.emiSummary);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export { buildCreditCardWorkbookBuffer };
