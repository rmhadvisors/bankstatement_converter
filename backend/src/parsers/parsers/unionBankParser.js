import { clean, parseAmount, parseDate, roundMoney } from "./common.js";
import { correctDebitCreditByBalance } from "../validation.js";

function isUnionBankLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /UNION\s+BANK\s+OF\s+INDIA/i.test(text) &&
    /DATE\s+PARTICULARS\s+CHQ\.?NO\.?\s+WITHDRAWALS\s+DEPOSITS\s+BALANCE/i.test(text)
  );
}

// Every "Sender"/"Beneficiary"/"Drawee"/"Collecting" sub-field a transfer's own reference block
// prints below its main row (UTR Number, Sender Account, Sender IFSC, Sender Bank, Sender Branch,
// Beneficary Acct -- sic, the statement's own spelling -- Beneficiary IFSC/Bank/Branch, Drawee
// Bank/Branch, Collecting Bank/Branch). Each is its own continuation line, never sharing a line
// with the transaction's own date/amount/balance.
const REFERENCE_LABEL_PATTERN =
  /^(UTR Number|Sender (?:Account|IFSC|Bank|Branch)|Beneficary Acct|Beneficiary (?:IFSC|Bank|Branch)|Drawee (?:Bank|Branch)|Collecting (?:Bank|Branch))\b\s*(.*)$/i;

function isRowStart(text) {
  return /^\d{2}-\d{2}-\d{4}\b/.test(text);
}

// The opening balance is printed as a bare "<amount> <amount>Cr" line (both figures equal) right
// under the column header -- no date, no particulars, so it needs its own check rather than
// falling through the general row pattern.
function parseOpeningBalanceLine(text) {
  const match = clean(text).match(/^([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(Cr|Dr)$/i);
  if (!match) return null;
  const opening = parseAmount(match[1]);
  const restated = parseAmount(`${match[2]}${match[3]}`);
  if (opening === null || restated === null || Math.abs(opening - Math.abs(restated)) > 0.01) return null;
  return restated;
}

function isNoise(text) {
  return (
    !text ||
    /^-{10,}$/.test(text) ||
    /^Transaction Details Page \d+ of \d+/i.test(text) ||
    /^UNION BANK OF INDIA$/i.test(text) ||
    /^DATE PARTICULARS CHQ\.?NO\.?\s+WITHDRAWALS\s+DEPOSITS\s+BALANCE/i.test(text) ||
    /^STATEMENT OF ACCOUNT FOR THE PERIOD FROM/i.test(text) ||
    /^TO:\s*DATE:/i.test(text) ||
    /^MR\s/i.test(text) ||
    /^MRS\s/i.test(text) ||
    /^PHONE:/i.test(text) ||
    /^Nominee Reg\. No:/i.test(text) ||
    /^Village\s*:/i.test(text) ||
    /CUST ID\s*:/i.test(text) ||
    /^IFSC\/MICR code for/i.test(text) ||
    /^Contact all India toll Free/i.test(text) ||
    /^FASTEST MODE OF FUNDS REMITTANCE/i.test(text) ||
    /^The Min\. Bal\. Requirement/i.test(text) ||
    /^Unless constituent notifies/i.test(text) ||
    /^by him in his statement of Account/i.test(text) ||
    /^To strengthen your Aadhaar/i.test(text) ||
    /^Manager$/i.test(text) ||
    /^https?:\/\//i.test(text) ||
    /^\d+,\w*powappsrv\d*,\S+\s+PAGE:\s*\d+/i.test(text)
  );
}

function splitChequeNoFromParticulars(middle) {
  const tokens = clean(middle).split(" ");
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && /^\d{6,10}$/.test(last)) {
    return { particulars: tokens.slice(0, -1).join(" "), chequeNo: last };
  }
  return { particulars: clean(middle), chequeNo: null };
}

const ROW_PATTERN = /^(\d{2}-\d{2}-\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*(Cr|Dr)$/i;

function parseUnionBankRow(text, previousBalance) {
  const match = clean(text).match(ROW_PATTERN);
  if (!match) return null;

  const date = parseDate(match[1]);
  const amount = parseAmount(match[3]);
  const balance = parseAmount(`${match[4]}${match[5]}`);
  if (!date || amount === null || balance === null) return null;

  const { particulars, chequeNo } = splitChequeNoFromParticulars(match[2]);

  let withdrawal = null;
  let deposit = null;
  if (previousBalance !== null) {
    const delta = roundMoney(balance - previousBalance);
    withdrawal = delta < 0 ? amount : null;
    deposit = delta >= 0 ? amount : null;
  } else if (/\/DR\//i.test(particulars)) {
    withdrawal = amount;
  } else {
    deposit = amount;
  }

  return {
    date,
    valueDate: date,
    particulars: particulars || "TRANSACTION",
    chequeNo,
    withdrawal,
    deposit,
    balance,
  };
}

function appendUnionBankContinuation(row, text) {
  const labelMatch = text.match(REFERENCE_LABEL_PATTERN);
  if (labelMatch) {
    const [, label, value] = labelMatch;
    if (/^UTR Number$/i.test(label) && !row.chequeNo && value) {
      row.chequeNo = clean(value);
    }
    row.particulars = clean(`${row.particulars} | ${clean(label)}: ${clean(value)}`);
    return;
  }

  row.particulars = clean(`${row.particulars} ${text}`);
}

function extractPrintedTotals(lines, openingBalance) {
  let last = null;
  for (const line of lines) {
    const text = clean(line.text || line);
    const match = text.match(/^Cumulative Totals:\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(Cr|Dr)$/i);
    if (match) {
      // This statement's own "Cumulative Totals" folds the opening balance into the Deposits
      // figure (confirmed against real data: printed deposits minus opening balance lands exactly
      // on the sum of this parser's own deposit rows) -- since the opening balance is never
      // emitted as a transaction row here, leaving it in would make the GRAND TOTAL row disagree
      // with the sum of its own column, which is worse than not showing a printed total at all.
      const printedDeposit = parseAmount(match[2]);
      last = {
        source: "printed",
        withdrawal: parseAmount(match[1]),
        deposit:
          printedDeposit !== null && openingBalance !== null
            ? roundMoney(printedDeposit - openingBalance)
            : printedDeposit,
        closingBalance: parseAmount(`${match[3]}${match[4]}`),
      };
    }
  }
  return last;
}

function parseUnionBankTransactions(lines) {
  const transactions = [];
  let current = null;
  let previousBalance = null;
  let openingBalance = null;

  const flush = () => {
    if (current) transactions.push(current);
    current = null;
  };

  for (const line of lines) {
    const text = clean(line.text || line);
    if (!text) continue;

    if (/^Cumulative Totals:/i.test(text)) {
      flush();
      continue;
    }

    if (isRowStart(text)) {
      flush();
      const row = parseUnionBankRow(text, previousBalance);
      if (row) {
        current = row;
        previousBalance = row.balance;
      }
      continue;
    }

    const lineOpeningBalance = parseOpeningBalanceLine(text);
    if (lineOpeningBalance !== null) {
      previousBalance = lineOpeningBalance;
      if (openingBalance === null) openingBalance = lineOpeningBalance;
      continue;
    }

    if (isNoise(text)) continue;
    if (!current) continue;

    appendUnionBankContinuation(current, text);
  }

  flush();

  return {
    transactions: correctDebitCreditByBalance(transactions),
    printedTotals: extractPrintedTotals(lines, openingBalance),
  };
}

export { isUnionBankLayout, parseUnionBankTransactions };
