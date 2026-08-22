import { clean, parseAmount, parseDate, roundMoney } from "./common.js";

// REP31 "Customer Account Ledger" report: a multi-page format distinct from the single-page
// Finacle "Transaction Inquiry" layout already handled by idbiParser.js. Every page repeats a
// bank-name/timestamp/"Page N" header block and a "B/F Balance" footer block -- none of that is
// part of the transaction table and must never reach the amount-parsing logic (a "Page 3" label
// misread as a balance figure is exactly the bug this format is prone to).
function isIdbiLedgerLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /IDBI\s+BANK\s+LTD/i.test(text) &&
    /REP31\s+Customer\s+Account\s+Ledger/i.test(text) &&
    /GL\.\s+Value\s+Tran\s+Id\s+Instrmnt\s+Particulars\s+Transaction\s+Transaction\s+Balance/i.test(text)
  );
}

// A row is "GL Date  Value Date  Tran Id  [Instrmnt Number]  Particulars  Amount  Balance(Cr|Dr)".
// The Instrmnt Number column is blank on almost every row (its value only ever shows up as a bare
// numeric token wedged between Tran Id and the particulars, which always start with a letter --
// "IMPS/", "UPI/", "NEFT-", "Int Coll:", "SMS_CHARGE_", "RENEWAL_CARDFE_", "BY CLG", "Ret-UPI/").
const ROW_PATTERN =
  /^(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4})\s+(\S+)\s+(?:(\d{4,})\s+)?(.+?)\s+([\d,]+\.\d{1,2})\s+([\d,]+\.\d{1,2})(Cr|Dr)$/i;

function isBoilerplate(text) {
  return (
    !text ||
    /^-{10,}$/.test(text) ||
    /^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\s+IDBI\s+BANK\s+LTD/i.test(text) ||
    /^REP31\s+Customer\s+Account\s+Ledger/i.test(text) ||
    /^Report To\s*:/i.test(text) ||
    /^SolId\s*:/i.test(text) ||
    /^Set id\s*:/i.test(text) ||
    /^Gl Sub Head Code\s*:/i.test(text) ||
    /^Acct Range\s*:/i.test(text) ||
    /^CKYC NO\s*:/i.test(text) ||
    /^Currency Code\s*:/i.test(text) ||
    /^Account Label\s*:/i.test(text) ||
    /^Open\/Closed A\/cs/i.test(text) ||
    /^Period\s*:/i.test(text) ||
    /^Limit Details\s*:/i.test(text) ||
    /^Order by GL\.?\s*Date\.?$/i.test(text) ||
    /^Service OutLet\s*:/i.test(text) ||
    /^Account No\s*:/i.test(text) ||
    /^Opening Balance\s*:/i.test(text) ||
    /^B\/F Balance\s*:/i.test(text) ||
    /^Peg Review date\s*:/i.test(text) ||
    /^GL\.\s+Value\s+Tran\s+Id\s+Instrmnt/i.test(text) ||
    /^Date\s+Date\s+Number\s+Debit\s+Amount\s+Credit\s+Amount/i.test(text) ||
    /^Page Total Credit\s*:/i.test(text) ||
    /^Page Total Debit\s*:/i.test(text) ||
    /^Closing Balance\s*:/i.test(text) ||
    /^Total Credit\s*:/i.test(text) ||
    /^Total Debit\s*:/i.test(text) ||
    /^Signature\b/i.test(text) ||
    /^\*+\s*\d+\s+pages printed\.?\s*End of Report\s*\*+$/i.test(text)
  );
}

function detectAmountColumns(lines) {
  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!/Debit\s+Amount/i.test(text) || !/Credit\s+Amount/i.test(text)) continue;
    const findX = (pattern) => (entry.items || []).find((item) => pattern.test(clean(item.text)))?.x ?? null;
    return {
      debit: findX(/^Debit Amount$/i) ?? 617,
      credit: findX(/^Credit Amount$/i) ?? 743,
    };
  }
  return { debit: 617, credit: 743 };
}

function extractOpeningBalance(lines) {
  for (const entry of lines) {
    const text = clean(entry.text || entry);
    const match = text.match(/^Opening Balance\s*:\s*([\d,]+\.\d{1,2})\s*(Cr|Dr)$/i);
    if (match) return parseAmount(`${match[1]}${match[2]}`);
  }
  return null;
}

function classifyTranType(particulars) {
  const text = clean(particulars);
  if (/^Ret-UPI\b/i.test(text)) return "Ret-UPI";
  if (/^UPI\b/i.test(text)) return "UPI";
  if (/^IMPS\b/i.test(text)) return "IMPS";
  if (/^NEFT/i.test(text)) return "NEFT";
  if (/^Int Coll\b/i.test(text)) return "Int Coll";
  if (/^SMS_CHARGE/i.test(text)) return "SMS_CHARGE";
  if (/^RENEWAL_CARDFE/i.test(text)) return "RENEWAL_CARDFE";
  if (/^BY CLG\b/i.test(text)) return "BY CLG";
  return "";
}

function parseIdbiLedgerTransactions(lines) {
  const columns = detectAmountColumns(lines);
  const openingBalance = extractOpeningBalance(lines);
  const transactions = [];
  const pageSubtotals = [];

  let runningBalance = openingBalance;
  let currentPageNumber = null;
  let pageCredit = 0;
  let pageDebit = 0;
  let printedTotalCredit = null;
  let printedTotalDebit = null;
  let printedClosingBalance = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (entry.pageNumber !== currentPageNumber) {
      currentPageNumber = entry.pageNumber;
      pageCredit = 0;
      pageDebit = 0;
    }

    const bfMatch = text.match(/^B\/F Balance\s*:\s*([\d,]+\.\d{1,2})\s*(Cr|Dr)$/i);
    if (bfMatch) {
      runningBalance = parseAmount(`${bfMatch[1]}${bfMatch[2]}`);
      continue;
    }

    const pageCreditMatch = text.match(/^Page Total Credit\s*:\s*([\d,]+\.\d{1,2})$/i);
    if (pageCreditMatch) {
      pageSubtotals.push({
        pageNumber: entry.pageNumber,
        kind: "Credit",
        printed: parseAmount(pageCreditMatch[1]),
        actual: roundMoney(pageCredit),
      });
      continue;
    }

    const pageDebitMatch = text.match(/^Page Total Debit\s*:\s*([\d,]+\.\d{1,2})$/i);
    if (pageDebitMatch) {
      pageSubtotals.push({
        pageNumber: entry.pageNumber,
        kind: "Debit",
        printed: parseAmount(pageDebitMatch[1]),
        actual: roundMoney(pageDebit),
      });
      continue;
    }

    const totalCreditMatch = text.match(/^Total Credit\s*:\s*([\d,]+\.\d{1,2})$/i);
    if (totalCreditMatch) {
      printedTotalCredit = parseAmount(totalCreditMatch[1]);
      continue;
    }

    const totalDebitMatch = text.match(/^Total Debit\s*:\s*([\d,]+\.\d{1,2})$/i);
    if (totalDebitMatch) {
      printedTotalDebit = parseAmount(totalDebitMatch[1]);
      continue;
    }

    const closingMatch = text.match(/^Closing Balance\s*:\s*([\d,]+\.\d{1,2})\s*(Cr|Dr)$/i);
    if (closingMatch) {
      printedClosingBalance = parseAmount(`${closingMatch[1]}${closingMatch[2]}`);
      continue;
    }

    if (isBoilerplate(text)) continue;

    const rowMatch = text.match(ROW_PATTERN);
    if (!rowMatch) continue;

    const [, txnDateRaw, valueDateRaw, tranId, instrmntNumber, particularsRaw, amountRaw, balanceDigits, balanceSign] =
      rowMatch;
    const date = parseDate(txnDateRaw);
    const valueDate = parseDate(valueDateRaw);
    const amount = parseAmount(amountRaw);
    const balance = parseAmount(`${balanceDigits}${balanceSign}`);
    if (!date || amount === null || balance === null) continue;

    const amountItem = (entry.items || []).find((item) => clean(item.text) === amountRaw);
    const isDebit =
      amountItem != null
        ? amountItem.x < columns.credit
        : runningBalance !== null
          ? roundMoney(runningBalance - amount) === roundMoney(balance)
          : true;

    const particulars = clean(particularsRaw) || "TRANSACTION";

    transactions.push({
      date,
      txnDate: date,
      valueDate,
      particulars,
      tranType: classifyTranType(particulars),
      chequeNo: tranId || null,
      chequeDetails: instrmntNumber || null,
      withdrawal: isDebit ? amount : null,
      deposit: isDebit ? null : amount,
      balance,
      pageNumber: entry.pageNumber,
    });

    if (isDebit) {
      pageDebit = roundMoney(pageDebit + amount);
    } else {
      pageCredit = roundMoney(pageCredit + amount);
    }
    runningBalance = balance;
  }

  const reconciliationIssues = [];
  for (const subtotal of pageSubtotals) {
    if (subtotal.printed === null) continue;
    if (Math.abs(subtotal.printed - subtotal.actual) > 0.01) {
      reconciliationIssues.push(
        `Page ${subtotal.pageNumber} Total ${subtotal.kind} mismatch: statement says ${subtotal.printed}, extracted rows sum to ${subtotal.actual}.`,
      );
    }
  }

  const totalWithdrawal = roundMoney(
    transactions.reduce((sum, row) => sum + Number(row.withdrawal || 0), 0),
  );
  const totalDeposit = roundMoney(transactions.reduce((sum, row) => sum + Number(row.deposit || 0), 0));

  if (printedTotalDebit !== null && Math.abs(printedTotalDebit - totalWithdrawal) > 0.01) {
    reconciliationIssues.push(
      `Statement Total Debit is ${printedTotalDebit} but extracted Withdrawal total is ${totalWithdrawal}.`,
    );
  }
  if (printedTotalCredit !== null && Math.abs(printedTotalCredit - totalDeposit) > 0.01) {
    reconciliationIssues.push(
      `Statement Total Credit is ${printedTotalCredit} but extracted Deposit total is ${totalDeposit}.`,
    );
  }

  const printedTotals =
    printedTotalCredit !== null && printedTotalDebit !== null
      ? {
          source: "printed",
          withdrawal: printedTotalDebit,
          deposit: printedTotalCredit,
          closingBalance: printedClosingBalance,
        }
      : null;

  return {
    transactions: transactions.map(({ pageNumber, ...row }) => row),
    printedTotals,
    openingBalance,
    reconciliationIssues,
  };
}

export { isIdbiLedgerLayout, parseIdbiLedgerTransactions };
