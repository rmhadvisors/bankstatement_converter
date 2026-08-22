import { clean, parseAmount, parseDate, roundMoney } from "./common.js";

// Bassein Catholic Co-Op Bank "STATEMENT OF ACCOUNT": a continuous multi-line transaction table
// with NO repeating per-page footer/summary (unlike the IDBI REP31 ledger), just a repeating
// column-header line per page. Each transaction's first physical line carries both dates, the
// (optional) REFF, and all three trailing amounts on one line; the description then wraps across
// several further physical lines that carry nothing else. The critical failure mode this format
// used to hit: since a merged multi-transaction text block has no clean single date token, a
// generic date-scavenging fallback would seize on some unrelated digit run (a reference number, a
// UTR fragment) and misinterpret it as a date -- producing dates like "31-01-2040" that are
// decades outside the statement's own period. Anchoring strictly on this line's own two leading
// DD-MMM-YYYY dates (never falling back to scanning the rest of the line for "a" date) is what
// prevents that.
function isBccbLedgerLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /BASSEIN\s+CATHOLIC\s+CO-OP\s+BANK\s+LTD/i.test(text) &&
    /TRANS\s+DATE\s+VALUE\s+DATE\s+REFF\s+DESCRIPTION\s+DEBITS\s+CREDITS\s+BALANCE/i.test(text)
  );
}

// A transaction row -- and ONLY a transaction row -- starts with two DD-MMM-YYYY dates. This is
// true even for reference-less fixed-charge lines ("RTGS CHARGES", "GST", "SMS CHARGE -CD",
// "TDS ON CASH"): every one of them still carries its own Trans Date/Value Date pair. No
// continuation (wrapped-narration) line ever starts this way, so this is a safe, unambiguous row
// boundary -- exactly what the merged-multi-transaction bug needed.
const ROW_PATTERN =
  /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+([\d,]+\.\d{1,2})\s+([\d,]+\.\d{1,2})\s+([\d,]+\.\d{1,2})$/;

const REFF_PATTERN = /^\d{9,}$/;

function isBoilerplate(text) {
  return (
    !text ||
    /^TRANS\s+DATE\s+VALUE\s+DATE\s+REFF\s+DESCRIPTION\s+DEBITS\s+CREDITS\s+BALANCE$/i.test(text) ||
    /^STATEMENT OF ACCOUNT$/i.test(text) ||
    /^BASSEIN CATHOLIC CO-OP BANK LTD\b/i.test(text) ||
    /^Account Branch\s*:/i.test(text) ||
    /^IFSC\s*:/i.test(text) ||
    /^MICR\s*:/i.test(text) ||
    /^Account No\s*:/i.test(text) ||
    /^Product\s*:/i.test(text) ||
    /^Account Title\s*:/i.test(text) ||
    /^Address\s*:/i.test(text) ||
    /^Joint Holder\s*:/i.test(text) ||
    /^Period\s*:/i.test(text) ||
    /^Name Currency\s*:/i.test(text)
  );
}

function isTerminalLine(text) {
  return /^Statement Summary\s*:/i.test(text) || /^\*+\s*END OF STATEMENT\s*\*+$/i.test(text);
}

function extractStatementPeriod(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  const match = text.match(/Period\s*:\s*(\d{2}-[A-Za-z]{3}-\d{4})\s*To\s*(\d{2}-[A-Za-z]{3}-\d{4})/i);
  if (!match) return null;
  const start = parseDate(match[1]);
  const end = parseDate(match[2]);
  return start && end ? { start, end } : null;
}

// The footer prints "Opening Balance Total Debit Amount Total Credit Amount Debit Count Credit
// Count Closing Balance" as a wrapped multi-line header, then all six values as one line of plain
// numbers in that same order -- distinguishing it from any transaction row (which only ever has
// three trailing amounts) is exactly the six-number shape matched here.
const SUMMARY_PATTERN =
  /^([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\d+)\s+(\d+)\s+([\d,]+\.\d{2})$/;

function extractStatementSummary(lines) {
  let afterHeader = false;
  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (/^Statement Summary\s*:/i.test(text)) {
      afterHeader = true;
      continue;
    }
    if (!afterHeader) continue;
    const match = text.match(SUMMARY_PATTERN);
    if (!match) continue;
    return {
      openingBalance: parseAmount(match[1]),
      totalDebit: parseAmount(match[2]),
      totalCredit: parseAmount(match[3]),
      debitCount: Number(match[4]),
      creditCount: Number(match[5]),
      closingBalance: parseAmount(match[6]),
    };
  }
  return null;
}

function shouldGlueContinuation(particulars) {
  return /-$/.test(particulars);
}

// ponytail: narration continuation lines are re-joined with a space by default and glued
// directly only when the accumulated text already ends in "-" (this bank's own wrap convention
// for a mid-token break). A genuine mid-word break with no trailing "-" (e.g. a UTR digit run
// split exactly at the page's character width, with the last 1-2 digits landing alone on the next
// line) isn't detected and comes through with a stray space instead. None of Bug 1-7 require
// perfect narration spacing -- ceiling/upgrade path: reconstruct from item x-coordinates instead
// of line text if exact narration fidelity is ever required.
function appendContinuation(row, text) {
  const continuation = clean(text);
  if (!continuation) return;

  if (shouldGlueContinuation(row.particulars)) {
    row.particulars = `${row.particulars}${continuation}`;
    return;
  }

  row.particulars = clean(`${row.particulars} ${continuation}`);
}

function parseBccbRow(match) {
  const [, txnDateRaw, valueDateRaw, reffAndDescription, debitRaw, creditRaw, balanceRaw] = match;
  const date = parseDate(txnDateRaw);
  const valueDate = parseDate(valueDateRaw);
  const debit = parseAmount(debitRaw) ?? 0;
  const credit = parseAmount(creditRaw) ?? 0;
  const balance = parseAmount(balanceRaw);

  const spaceIndex = reffAndDescription.indexOf(" ");
  const firstToken = spaceIndex === -1 ? reffAndDescription : reffAndDescription.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : reffAndDescription.slice(spaceIndex + 1);

  if (firstToken === "B/F") {
    return { isOpeningBalance: true, balance };
  }

  const hasReff = REFF_PATTERN.test(firstToken);
  const reff = hasReff ? firstToken : null;
  const particulars = clean(hasReff ? rest : reffAndDescription);

  return {
    isOpeningBalance: false,
    date,
    txnDate: date,
    valueDate,
    particulars: particulars || "TRANSACTION",
    chequeNo: reff,
    withdrawal: debit > 0 ? debit : null,
    deposit: credit > 0 ? credit : null,
    type: debit > 0 ? "DR" : credit > 0 ? "CR" : "",
    balance,
  };
}

function parseBccbLedgerTransactions(lines) {
  const period = extractStatementPeriod(lines);
  const summary = extractStatementSummary(lines);

  const transactions = [];
  const flaggedRows = [];
  let current = null;
  let openingBalance = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (isTerminalLine(text)) {
      current = null;
      continue;
    }

    const rowMatch = text.match(ROW_PATTERN);
    if (rowMatch) {
      const row = parseBccbRow(rowMatch);

      if (row.isOpeningBalance) {
        if (openingBalance === null) openingBalance = row.balance;
        current = null;
        continue;
      }

      // Sanity bound (Bug 1): a date that fails to parse as a real DD-MMM-YYYY token, or one that
      // falls outside the statement's own stated period, is never fabricated into output -- the
      // row is flagged for review and left out of the transaction list entirely.
      const outOfRange =
        period && row.date && (row.date < period.start || row.date > period.end);
      if (!row.date || !row.valueDate || outOfRange) {
        flaggedRows.push({
          ...row,
          reason: !row.date || !row.valueDate ? "Unparseable transaction date." : "Date falls outside the statement's own period.",
        });
        current = null;
        continue;
      }

      transactions.push(row);
      current = row;
      continue;
    }

    if (!current || isBoilerplate(text)) continue;

    appendContinuation(current, text);
  }

  const totalWithdrawal = roundMoney(
    transactions.reduce((sum, row) => sum + Number(row.withdrawal || 0), 0),
  );
  const totalDeposit = roundMoney(transactions.reduce((sum, row) => sum + Number(row.deposit || 0), 0));
  const closingBalance = transactions.length ? transactions[transactions.length - 1].balance : null;

  const reconciliationIssues = [];
  if (summary) {
    if (Math.abs(summary.totalDebit - totalWithdrawal) > 0.01) {
      reconciliationIssues.push(
        `Statement Total Debit Amount is ${summary.totalDebit} but extracted Withdrawal total is ${totalWithdrawal}.`,
      );
    }
    if (Math.abs(summary.totalCredit - totalDeposit) > 0.01) {
      reconciliationIssues.push(
        `Statement Total Credit Amount is ${summary.totalCredit} but extracted Deposit total is ${totalDeposit}.`,
      );
    }
    if (closingBalance === null || Math.abs(summary.closingBalance - closingBalance) > 0.01) {
      reconciliationIssues.push(
        `Statement Closing Balance is ${summary.closingBalance} but the last extracted row's balance is ${closingBalance}.`,
      );
    }
    const expectedCount = summary.debitCount + summary.creditCount;
    if (transactions.length !== expectedCount) {
      reconciliationIssues.push(
        `Statement Debit Count + Credit Count is ${expectedCount} (${summary.debitCount} + ${summary.creditCount}) but ${transactions.length} row(s) were extracted.`,
      );
    }
  }
  if (flaggedRows.length > 0) {
    reconciliationIssues.push(
      `${flaggedRows.length} row(s) had an unparseable or out-of-period date and were excluded from output -- see flaggedRows.`,
    );
  }

  const printedTotals = summary
    ? {
        source: "printed",
        withdrawal: summary.totalDebit,
        deposit: summary.totalCredit,
        closingBalance: summary.closingBalance,
      }
    : null;

  return {
    transactions,
    printedTotals,
    openingBalance: openingBalance ?? summary?.openingBalance ?? null,
    flaggedRows,
    reconciliationIssues,
  };
}

export { isBccbLedgerLayout, parseBccbLedgerTransactions };
