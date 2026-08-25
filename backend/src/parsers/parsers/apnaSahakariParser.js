import { clean, parseAmount, parseDate, roundMoney } from "./common.js";

// Apna Sahakari Bank Ltd. "STATEMENT OF ACCOUNTS" (report code R045006), a born-digital,
// debit/credit-column CD (current) account statement -- real embedded text, no OCR needed.
//
// Each transaction's date, particulars (first fragment), optional instrument ref, exactly one of
// Dr Amount/Cr Amount, and the running Total Amount balance all land on ONE physical PDF line
// (clusterTextItems groups same-y text into one row); any further wrapped particulars fragments
// print on their own lines below with no columnar content at all. Dr and Cr share a single visual
// column pair with no per-row label distinguishing them, so which one a row's lone amount is gets
// decided by x-position against the header row's own column anchors, not by scanning text.
const HEADER_ROW_LABELS = ["Date", "Particulars", "Instruments", "Dr Amount", "Cr Amount", "Total Amount"];

function isApnaSahakariLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /APNA\s+SAHAKARI\s+BANK\s+LTD/i.test(text) &&
    /R045006\s*-\s*STATEMENT OF ACCOUNTS/i.test(text) &&
    /Date\s+Particulars\s+Instruments\s+Dr Amount\s+Cr Amount\s+Total Amount/i.test(text)
  );
}

function isBoilerplate(text) {
  return (
    !text ||
    /^APNA SAHAKARI BANK LTD\.?/i.test(text) ||
    /^User Id\b/i.test(text) ||
    /^R045006\s*-\s*STATEMENT OF ACCOUNTS/i.test(text) ||
    /^Printed On\b/i.test(text) ||
    /^Branch\s*:/i.test(text) ||
    /^Account\s*:\s*CD\//i.test(text) ||
    /^CBS Account No\b/i.test(text) ||
    /^Address\s*:/i.test(text) ||
    /^From Date\s*:/i.test(text) ||
    /^IFSC Code\s*:/i.test(text) ||
    /^Date\s+Particulars\s+Instruments\b/i.test(text) ||
    /^-+$/.test(text) ||
    /^Closing Balance As On\b/i.test(text) ||
    /^This is a computer generated statement/i.test(text) ||
    /^\*+\s*End Of The Report\s*\*+$/i.test(text)
  );
}

function isTotalsLine(text) {
  return /^Totals\s*\/\s*Balance\s*:-/i.test(text);
}

// Column anchors read once from the header row itself rather than hardcoded, so a reprint with
// slightly different margins still classifies correctly.
function detectColumnAnchors(lines) {
  for (const line of lines) {
    const items = line.items || [];
    if (items.length !== HEADER_ROW_LABELS.length) continue;
    const matches = items.every((item, index) => clean(item.text) === HEADER_ROW_LABELS[index]);
    if (!matches) continue;
    return { instruments: items[2].x, dr: items[3].x, cr: items[4].x, total: items[5].x };
  }
  return null;
}

function extractMetadata(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  const accountMatch = text.match(/Account\s*:\s*(CD\/\d+)\s+Name\s*:\s*(.+)/i);
  const cbsMatch = text.match(/CBS Account No\s*:-\s*(\d+)/i);
  const periodMatch = text.match(/From Date:\s*(\d{2}\/\d{2}\/\d{4})\s+To Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const openingMatch = text.match(/Opening Balance\s*:\s*(-?[\d,]+\.\d{2})/i);

  return {
    accountNumber: accountMatch ? accountMatch[1] : null,
    accountHolder: accountMatch ? clean(accountMatch[2]) : null,
    cbsAccountNumber: cbsMatch ? cbsMatch[1] : null,
    periodStart: periodMatch ? parseDate(periodMatch[1]) : null,
    periodEnd: periodMatch ? parseDate(periodMatch[2]) : null,
    openingBalance: openingMatch ? parseAmount(openingMatch[1]) : null,
  };
}

const TOTALS_PATTERN = /^Totals\s*\/\s*Balance\s*:-\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/;

function extractStatementTotals(lines) {
  for (const line of lines) {
    const text = clean(line.text || line);
    const match = text.match(TOTALS_PATTERN);
    if (!match) continue;
    return {
      totalDr: parseAmount(match[1]),
      totalCr: parseAmount(match[2]),
      closingBalance: parseAmount(match[3]),
    };
  }
  return null;
}

const DATE_TOKEN = /^\d{2}\/\d{2}\/\d{4}$/;
const INSTRUMENT_TOKEN = /^\d{4,}$/;

// A row's own items (already left-to-right ordered by clusterTextItems): date, particulars (+
// optional instrument as its own item), the one populated Dr-or-Cr amount, then the balance --
// always in that fixed order, so position within the row -- not text scanning -- separates them.
function parseTransactionRow(items, anchors) {
  const date = parseDate(items[0].text);
  const balanceItem = items[items.length - 1];
  const amountItem = items[items.length - 2];
  const middleItems = items.slice(1, items.length - 2);

  let instrument = null;
  let particularsItems = middleItems;
  if (middleItems.length > 1) {
    const last = middleItems[middleItems.length - 1];
    const lastText = clean(last.text);
    if (INSTRUMENT_TOKEN.test(lastText) && Math.abs(last.x - anchors.instruments) < 60) {
      instrument = lastText;
      particularsItems = middleItems.slice(0, -1);
    }
  }

  const particulars = clean(particularsItems.map((item) => clean(item.text)).join(" "));
  const amount = Math.abs(parseAmount(amountItem.text) ?? 0);
  const balance = parseAmount(balanceItem.text);
  const midpoint = (anchors.dr + anchors.cr) / 2;
  const isDebit = amountItem.x < midpoint;

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo: instrument,
    withdrawal: isDebit ? amount : null,
    deposit: isDebit ? null : amount,
    type: isDebit ? "DR" : "CR",
    balance,
  };
}

function shouldGlueContinuation(particulars) {
  return /[/-]$/.test(particulars);
}

function appendContinuation(row, text) {
  const continuation = clean(text);
  if (!continuation) return;

  if (shouldGlueContinuation(row.particulars)) {
    row.particulars = `${row.particulars}${continuation}`;
    return;
  }

  row.particulars = clean(`${row.particulars} ${continuation}`);
}

function parseApnaSahakariTransactions(lines) {
  const metadata = extractMetadata(lines);
  const totals = extractStatementTotals(lines);
  const anchors = detectColumnAnchors(lines);

  const transactions = [];
  const flaggedRows = [];
  let current = null;

  for (const line of lines) {
    const text = clean(line.text || line);
    if (!text) continue;

    if (isTotalsLine(text)) {
      current = null;
      continue;
    }

    const items = line.items || [];
    const isRowStart = items.length >= 3 && DATE_TOKEN.test(clean(items[0].text));

    if (isRowStart && anchors) {
      const row = parseTransactionRow(items, anchors);

      if (!row.date) {
        flaggedRows.push({ ...row, reason: "Unparseable transaction date." });
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

  const totalWithdrawal = roundMoney(transactions.reduce((sum, row) => sum + Number(row.withdrawal || 0), 0));
  const totalDeposit = roundMoney(transactions.reduce((sum, row) => sum + Number(row.deposit || 0), 0));
  const closingBalance = transactions.length ? transactions[transactions.length - 1].balance : null;

  const reconciliationIssues = [];
  if (totals) {
    if (Math.abs(totals.totalDr - totalWithdrawal) > 0.01) {
      reconciliationIssues.push(
        `Statement Totals row Dr Amount is ${totals.totalDr} but extracted withdrawal total is ${totalWithdrawal}.`,
      );
    }
    if (Math.abs(totals.totalCr - totalDeposit) > 0.01) {
      reconciliationIssues.push(
        `Statement Totals row Cr Amount is ${totals.totalCr} but extracted deposit total is ${totalDeposit}.`,
      );
    }
    if (closingBalance === null || Math.abs(totals.closingBalance - closingBalance) > 0.01) {
      reconciliationIssues.push(
        `Statement Totals row balance is ${totals.closingBalance} but the last extracted row's balance is ${closingBalance}.`,
      );
    }
  }

  // Running-balance chain check (balance[i] = balance[i-1] - Dr + Cr), the row-level counterpart
  // to the whole-statement totals check above -- a column-swap on a single row can still leave the
  // aggregate Dr/Cr totals and closing balance looking right while that one row's own balance is
  // wrong, so this is what catches it.
  let runningBalance = metadata.openingBalance;
  const chainBreaks = [];
  for (const [index, row] of transactions.entries()) {
    if (runningBalance !== null && row.balance !== null) {
      const expected = roundMoney(runningBalance - Number(row.withdrawal || 0) + Number(row.deposit || 0));
      if (Math.abs(expected - row.balance) > 0.01) {
        chainBreaks.push(`row ${index + 1} (${row.particulars}): expected ${expected}, statement shows ${row.balance}`);
      }
    }
    runningBalance = row.balance;
  }
  if (chainBreaks.length > 0) {
    const shown = chainBreaks.slice(0, 5).join("; ");
    const more = chainBreaks.length > 5 ? ` (+${chainBreaks.length - 5} more)` : "";
    reconciliationIssues.push(`Running-balance chain broke on ${chainBreaks.length} row(s): ${shown}${more}.`);
  }

  if (flaggedRows.length > 0) {
    reconciliationIssues.push(
      `${flaggedRows.length} row(s) had an unparseable date and were excluded from output -- see flaggedRows.`,
    );
  }
  if (!anchors) {
    reconciliationIssues.push("Could not locate the column header row -- transactions were not extracted.");
  }

  const printedTotals = totals
    ? { source: "printed", withdrawal: totals.totalDr, deposit: totals.totalCr, closingBalance: totals.closingBalance }
    : null;

  return {
    transactions,
    printedTotals,
    openingBalance: metadata.openingBalance,
    metadata,
    flaggedRows,
    reconciliationIssues,
  };
}

export { isApnaSahakariLayout, parseApnaSahakariTransactions };
