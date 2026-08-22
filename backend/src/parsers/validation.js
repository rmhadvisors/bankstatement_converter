import { roundMoney } from "./parsers/common.js";

function moneyOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? roundMoney(number) : null;
}

function transactionKey(row) {
  const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || "");
  return [
    date,
    String(row.particulars || "").replace(/\s+/g, " ").trim().toLowerCase(),
    moneyOrNull(row.withdrawal) || 0,
    moneyOrNull(row.deposit) || 0,
    moneyOrNull(row.balance) || 0,
  ].join("|");
}

function getOpeningBalance(lines, transactions) {
  const chronological = isChronological(transactions);
  const edge = chronological ? transactions[0] : transactions[transactions.length - 1];
  if (edge?.balance !== null && edge?.balance !== undefined) {
    const withdrawal = Number(edge.withdrawal || 0);
    const deposit = Number(edge.deposit || 0);
    return roundMoney(Number(edge.balance) + withdrawal - deposit);
  }

  for (const entry of lines || []) {
    const text = String(entry.text || entry || "").replace(/\s+/g, " ").trim();
    if (!/opening balance|balance brought forward/i.test(text)) continue;
    const match = text.match(/-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}/g);
    if (match?.length) {
      return roundMoney(Number(match.at(-1).replace(/,/g, "")));
    }
  }

  return null;
}

function isChronological(transactions) {
  const dated = transactions.filter((row) => row.date instanceof Date);
  if (dated.length < 2) return true;

  let forward = 0;
  let backward = 0;
  for (let index = 1; index < dated.length; index += 1) {
    const diff = dated[index].date.getTime() - dated[index - 1].date.getTime();
    if (diff > 0) forward += 1;
    if (diff < 0) backward += 1;
  }

  return forward >= backward;
}

function calculateTransactionTotals(transactions) {
  const result = transactions.reduce(
    (totals, row) => {
      totals.withdrawal += Number(row.withdrawal || 0);
      totals.deposit += Number(row.deposit || 0);
      totals.closingBalance = moneyOrNull(row.balance);
      return totals;
    },
    { withdrawal: 0, deposit: 0, closingBalance: null },
  );

  return {
    withdrawal: roundMoney(result.withdrawal),
    deposit: roundMoney(result.deposit),
    closingBalance: result.closingBalance,
  };
}

function findBalanceBreaks(transactions, openingBalance) {
  const breaks = [];
  const rows = isChronological(transactions) ? transactions : [...transactions].reverse();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previousBalance =
      index === 0 ? openingBalance : moneyOrNull(rows[index - 1]?.balance);
    const balance = moneyOrNull(row.balance);

    if (previousBalance === null || balance === null) continue;

    const expected = roundMoney(previousBalance - Number(row.withdrawal || 0) + Number(row.deposit || 0));
    if (Math.abs(expected - balance) > 0.05) {
      breaks.push({
        rowNumber: index + 1,
        date: row.date,
        particulars: row.particulars,
        expectedBalance: expected,
        actualBalance: balance,
        difference: roundMoney(balance - expected),
      });
    }
  }

  return breaks;
}

// Bank reference/UTR numbers are used for reconciliation against other systems -- a single
// dropped character (most often an OCR misread on one particular occurrence of an otherwise
// legible number, e.g. a font/scan-quality difference between two printings of the same UTR on
// the same statement) silently produces a DIFFERENT, equally well-formed-looking reference
// number, which is worse than an obviously broken one because nothing about it looks wrong in
// isolation. Rather than guess at the missing character (which would just be fabricating data),
// every reference number in one recognizable, self-consistent family found in this statement is
// compared against the others in that same family.
//
// Restricted to the RTGS-style family specifically -- a 4-letter bank/SWIFT-ish code followed by
// a literal "R" (for RTGS) and then a long digit run, e.g. "IBKLR92025091500011989" -- rather than
// any reference-shaped token in general: this statement's OTHER reference numbers (plain NEFT UTRs
// like "IBKL25060639377", instrument codes like "BACBH00003925022") are legitimately shorter and
// differently shaped, so comparing every reference number's length against one statement-wide mode
// buried the one real corruption ("IBKR..." instead of "IBKLR...", a dropped 'L') under false
// positives from those unrelated, correctly-shaped formats. Every RTGS-style reference in a given
// statement should share the exact same length (same bank-code width, same date/serial digit
// count), so an outlier within just this family is a strong, precise signal of a dropped character.
const RTGS_REFERENCE_REGEX = /\b[A-Z]{3,5}R\d{10,20}\b/g;

function findSuspiciousReferenceNumbers(transactions) {
  const occurrences = [];
  (transactions || []).forEach((row, index) => {
    const text = String(row.particulars || "");
    for (const match of text.matchAll(RTGS_REFERENCE_REGEX)) {
      occurrences.push({ rowNumber: index + 1, particulars: row.particulars, token: match[0], length: match[0].length });
    }
  });

  // Need at least a few reference numbers to establish what "normal" looks like for this
  // statement; with fewer than that, an apparent outlier is just as likely to be the only real
  // sample rather than proof of corruption.
  if (occurrences.length < 3) return [];

  const lengthCounts = new Map();
  for (const occurrence of occurrences) {
    lengthCounts.set(occurrence.length, (lengthCounts.get(occurrence.length) || 0) + 1);
  }
  const [modeLength] = [...lengthCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return occurrences
    .filter((occurrence) => occurrence.length !== modeLength)
    .map((occurrence) => ({
      rowNumber: occurrence.rowNumber,
      particulars: occurrence.particulars,
      token: occurrence.token,
      length: occurrence.length,
      expectedLength: modeLength,
    }));
}

function correctDebitCreditByBalance(transactions) {
  const rows = isChronological(transactions) ? transactions : [...transactions].reverse();

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const row = rows[index];
    const previousBalance = moneyOrNull(previous?.balance);
    const balance = moneyOrNull(row?.balance);
    if (previousBalance === null || balance === null) continue;

    const delta = roundMoney(balance - previousBalance);
    if (Math.abs(delta) <= 0.01) {
      row.withdrawal = null;
      row.deposit = null;
      continue;
    }

    const debit = moneyOrNull(row.withdrawal);
    const credit = moneyOrNull(row.deposit);
    const amount = Math.abs(delta);
    
    const hasAmount = debit !== null || credit !== null;
    const sameMonth = previous.date && row.date && 
      previous.date.getUTCMonth() === row.date.getUTCMonth() && 
      previous.date.getUTCFullYear() === row.date.getUTCFullYear();
      
    const debitMatches = debit !== null && Math.abs(debit - amount) <= 1.0;
    const creditMatches = credit !== null && Math.abs(credit - amount) <= 1.0;
    
    if (hasAmount && !debitMatches && !creditMatches && !sameMonth) {
      // Keep original parsed amounts; do not corrupt them due to potential cross-month balance breaks
      continue;
    }

    // Once we reach here, the balance chain is trusted as ground truth for both the side
    // (debit/credit) and the amount: clear whatever was parsed and rebuild from the delta.
    // This also clears a spurious opposite-side value left over from a misread stray number
    // (e.g. a narration reference digit that landed in the debit column alongside a correctly
    // parsed credit amount).
    if (delta < 0) {
      row.withdrawal = amount;
      row.deposit = null;
    } else if (delta > 0) {
      row.deposit = amount;
      row.withdrawal = null;
    }
  }

  return transactions;
}

// Heuristic 0-100 confidence score for a single OCR-sourced transaction row. OCR.space (the
// primary cloud OCR provider used by ocrExtractor.js) does not expose per-word confidence in its
// response, so this is derived from parse/validation signals instead of an OCR engine's own
// confidence value: whether required fields are present, whether the balance chain is
// consistent with the previous row, and whether any of the row's source tokens needed an
// ambiguous-character correction (see ocrCorrections.js).
function scoreTransactionConfidence(row, previousRow) {
  const reasons = [];
  let score = 100;

  const hasValidDate = row.date instanceof Date && !Number.isNaN(row.date.getTime());
  if (!hasValidDate) {
    score -= 40;
    reasons.push("Missing or unparseable date.");
  }

  const withdrawal = moneyOrNull(row.withdrawal);
  const deposit = moneyOrNull(row.deposit);
  if (withdrawal === null && deposit === null) {
    score -= 40;
    reasons.push("No debit or credit amount was found.");
  }

  const balance = moneyOrNull(row.balance);
  const previousBalance = moneyOrNull(previousRow?.balance);
  if (previousBalance !== null && balance !== null) {
    const expected = roundMoney(previousBalance - Number(withdrawal || 0) + Number(deposit || 0));
    if (Math.abs(expected - balance) > 0.05) {
      score -= 30;
      reasons.push("Balance does not follow from the previous row's balance and this row's amount.");
    }
  }

  if (row.hadOcrCorrections) {
    score -= 15;
    reasons.push("One or more fields required OCR character correction.");
  }

  return { score: Math.max(0, score), reasons };
}

function buildValidationReport(statement, lines = []) {
  const transactions = statement.transactions || [];
  const issues = [];
  const warnings = [];
  const duplicates = [];
  const seen = new Map();

  for (let index = 0; index < transactions.length; index += 1) {
    const row = transactions[index];
    const withdrawal = moneyOrNull(row.withdrawal);
    const deposit = moneyOrNull(row.deposit);

    if (withdrawal !== null && deposit !== null && withdrawal !== 0 && deposit !== 0) {
      issues.push({
        severity: "error",
        rowNumber: index + 1,
        message: "Both debit and credit values are present on one transaction.",
      });
    }

    if ((withdrawal !== null && withdrawal < 0) || (deposit !== null && deposit < 0)) {
      issues.push({
        severity: "error",
        rowNumber: index + 1,
        message: "Debit or credit amount is negative after normalization.",
      });
    }

    const key = transactionKey(row);
    if (seen.has(key)) {
      duplicates.push({ rowNumber: index + 1, duplicateOf: seen.get(key), particulars: row.particulars });
    } else {
      seen.set(key, index + 1);
    }
  }

  const openingBalance = getOpeningBalance(lines, transactions);
  const calculated = calculateTransactionTotals(transactions);
  const printed = statement.printedTotals || null;
  const chronological = isChronological(transactions);
  const rowClosingBalance = moneyOrNull(
    chronological ? transactions.at(-1)?.balance : transactions[0]?.balance,
  );
  const statementClosingBalance = moneyOrNull(
    printed?.closingBalance ?? statement.totals?.closingBalance ?? rowClosingBalance,
  );
  const calculatedClosingBalance =
    openingBalance === null
      ? calculated.closingBalance
      : roundMoney(openingBalance + calculated.deposit - calculated.withdrawal);
  const closingDifference =
    calculatedClosingBalance !== null && statementClosingBalance !== null
      ? roundMoney(calculatedClosingBalance - statementClosingBalance)
      : null;

  const balanceBreaks = findBalanceBreaks(transactions, openingBalance);
  const suspiciousReferenceNumbers = findSuspiciousReferenceNumbers(transactions);

  // Structural failures already identified during parsing (e.g. a block with no date-boundary
  // match, or an ambiguous number of amounts -- see ocrTransactionReconstructor.js) are seeded
  // in here first; heuristic confidence scoring below only adds rows on top of those, it never
  // replaces them.
  const reviewRows = [...(statement.reviewRows || [])];
  if (statement.ocrSourced) {
    const ordered = chronological ? transactions : [...transactions].reverse();
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index].isSynthetic) continue;
      const { score, reasons } = scoreTransactionConfidence(ordered[index], ordered[index - 1]);
      if (score < 80) {
        reviewRows.push({ ...ordered[index], confidence: score, reasons });
      }
    }
  }

  if (closingDifference !== null && Math.abs(closingDifference) > 0.05) {
    issues.push({
      severity: "error",
      message: "Opening balance plus credits minus debits does not match the statement closing balance.",
      difference: closingDifference,
    });
  }

  if (duplicates.length > 0) {
    warnings.push({
      severity: "warning",
      message: `${duplicates.length} duplicate transaction row(s) detected.`,
    });
  }

  if (balanceBreaks.length > 0) {
    warnings.push({
      severity: "warning",
      message: `${balanceBreaks.length} transaction balance chain mismatch(es) detected.`,
    });
  }

  if (suspiciousReferenceNumbers.length > 0) {
    warnings.push({
      severity: "warning",
      message: `${suspiciousReferenceNumbers.length} reference/UTR number(s) have an unexpected length compared to the others in this statement -- possible OCR character loss; verify against the source before using for reconciliation.`,
    });
  }

  return {
    openingBalance,
    totalCredits: calculated.deposit,
    totalDebits: calculated.withdrawal,
    calculatedClosingBalance,
    statementClosingBalance,
    closingDifference,
    transactionCount: transactions.length,
    duplicateTransactions: duplicates,
    suspiciousTransactions: balanceBreaks,
    suspiciousReferenceNumbers,
    reviewRows,
    issues,
    warnings,
    status: issues.length === 0 ? "PASS" : "FAIL",
  };
}

function removeDuplicateTransactions(transactions, logs = []) {
  const seen = new Set();
  const result = [];

  for (const row of transactions) {
    const key = transactionKey(row);
    if (seen.has(key)) {
      logs.push({
        level: "warn",
        stage: "validation",
        message: "Duplicate transaction skipped.",
        transaction: row.particulars,
      });
      continue;
    }
    seen.add(key);
    result.push(row);
  }

  return result;
}

export {
  buildValidationReport,
  calculateTransactionTotals,
  correctDebitCreditByBalance,
  removeDuplicateTransactions,
  findBalanceBreaks,
  findSuspiciousReferenceNumbers,
  scoreTransactionConfidence,
};
