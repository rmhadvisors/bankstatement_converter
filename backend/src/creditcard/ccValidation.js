import { roundMoney } from "./ccCommon.js";

const TOLERANCE = 1;

function rowKey(row) {
  return [
    row.date?.toISOString?.(),
    row.description,
    row.amount,
    row.type,
    row.cardLast4 || "",
  ].join("|");
}

// Drops rows a page break printed twice, keeps genuine repeats (two identical coffees on one day).
// A row is a duplicate when it repeats a reference number already seen, or -- with no reference
// number -- when it is identical to the row right before it AND sits on the next page.
// ponytail: an identical, ref-less genuine repeat that happens to straddle a page break is dropped;
// reconciliation then flags the shortfall. Upgrade path: compare line y-positions at the page edge.
function removeDuplicateRows(transactions) {
  const seenRefs = new Set();
  const kept = [];
  let removed = 0;

  for (const row of transactions) {
    const previous = kept.at(-1);
    const refKey = row.refNo ? `${row.refNo}|${rowKey(row)}` : null;
    const isDuplicate = refKey
      ? seenRefs.has(refKey)
      : Boolean(
          previous &&
          !previous.refNo &&
          rowKey(previous) === rowKey(row) &&
          previous.page !== row.page,
        );

    if (isDuplicate) {
      removed += 1;
      continue;
    }
    if (refKey) seenRefs.add(refKey);
    kept.push(row);
  }

  return { transactions: kept, removed };
}

function totals(transactions) {
  let debits = 0;
  let credits = 0;
  for (const row of transactions) {
    if (row.type === "credit") credits += row.amount;
    else debits += row.amount;
  }
  return { totalDebits: roundMoney(debits), totalCredits: roundMoney(credits) };
}

const formatMoney = (value) =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signed = (row) => (row.type === "credit" ? -row.amount : row.amount);
const describe = (row, index) =>
  `Row ${index + 1} (${row.date.toISOString().slice(0, 10)} ${row.description})`;

// For layouts that print a running balance: previous + debit - credit must equal each row's
// printed balance (±0.01), starting from the summary's previous balance. A row whose type is
// missing or misread (it only fits with the sign flipped) is corrected in place; any other
// mismatch is a break. The chain resyncs on the printed balance so one bad row is reported once.
// Returns null when the rows carry no balance.
function checkRunningBalance(summary, transactions) {
  if (
    transactions.length === 0 ||
    transactions.some((row) => row.balance === null || row.balance === undefined)
  ) {
    return null;
  }
  let previous =
    summary.previousBalance ?? roundMoney(transactions[0].balance - signed(transactions[0]));
  const breaks = [];
  const corrections = [];

  transactions.forEach((row, index) => {
    if (Math.abs(roundMoney(previous + signed(row)) - row.balance) > 0.01) {
      if (Math.abs(roundMoney(previous - signed(row)) - row.balance) <= 0.01) {
        row.type = row.type === "credit" ? "debit" : "credit";
        row.typeCorrected = true;
        corrections.push(
          `${describe(row, index)}: type corrected to ${row.type} from the running balance.`,
        );
      } else {
        row.balanceBreak = true;
        breaks.push(
          `${describe(row, index)}: printed balance ₹${formatMoney(row.balance)}, expected ₹${formatMoney(roundMoney(previous + signed(row)))}.`,
        );
      }
    }
    previous = row.balance;
  });

  return { checked: transactions.length, breaks, corrections, closingBalance: previous };
}

// The parsed rows are checked against the printed summary: previous balance + debits - credits
// should equal the total amount due (within ₹1). With a verified running balance (runningBalance
// from checkRunningBalance, no breaks) the rows are known good, so a summary mismatch is reported
// as the summary box disagreeing, not as rows being wrong.
function reconcile(summary, transactions, runningBalance = null) {
  const { totalDebits, totalCredits } = totals(transactions);
  const checks = [];
  const warnings = [];
  let financeChargesAddedSeparately = false;

  const { previousBalance, totalAmountDue, paymentsCredits, financeCharges } = summary;
  // Purchases may be printed with a separate "Other Debits" (fees, interest, taxes) and "Cash
  // Advance", payments with "Other Credits" (IDFC FIRST, Axis): together they are the statement's
  // debit/credit totals.
  const purchasesDebits =
    summary.purchasesDebits === undefined
      ? undefined
      : roundMoney(
          summary.purchasesDebits + (summary.otherDebits ?? 0) + (summary.cashAdvance ?? 0),
        );
  const printedCredits =
    paymentsCredits === undefined
      ? undefined
      : roundMoney(paymentsCredits + (summary.otherCredits ?? 0));

  if (previousBalance !== undefined && totalAmountDue !== undefined) {
    let expected = roundMoney(previousBalance + totalDebits - totalCredits);
    // Some issuers print finance charges only in the summary, not as a transaction row.
    if (Math.abs(expected - totalAmountDue) > TOLERANCE && financeCharges) {
      const withCharges = roundMoney(expected + financeCharges);
      if (Math.abs(withCharges - totalAmountDue) <= TOLERANCE) {
        expected = withCharges;
        financeChargesAddedSeparately = true;
      }
    }
    checks.push({
      name: "Previous balance + debits - credits = total amount due",
      expected,
      actual: totalAmountDue,
      difference: roundMoney(expected - totalAmountDue),
    });
  } else {
    warnings.push(
      "The statement summary's previous balance or total amount due could not be read, so the totals could not be reconciled.",
    );
  }

  // The printed equation itself: opening + purchases (+ other debits) - payments (- other credits)
  // = total due, with or without finance charges printed on their own.
  if (
    [previousBalance, totalAmountDue, purchasesDebits, printedCredits].every((v) => v !== undefined)
  ) {
    const base = roundMoney(previousBalance + purchasesDebits - printedCredits);
    const expected =
      Math.abs(base - totalAmountDue) > TOLERANCE && financeCharges
        ? roundMoney(base + financeCharges)
        : base;
    checks.push({
      name: "Printed summary adds up to the printed total amount due",
      expected,
      actual: totalAmountDue,
      difference: roundMoney(expected - totalAmountDue),
    });
  }

  if (purchasesDebits !== undefined) {
    // The printed purchases figure may or may not include fees/charges; either matching is fine.
    const matchesWithCharges =
      financeCharges && Math.abs(totalDebits - (purchasesDebits + financeCharges)) <= TOLERANCE;
    checks.push({
      name: "Parsed debits = printed purchases/debits",
      expected: matchesWithCharges ? roundMoney(purchasesDebits + financeCharges) : purchasesDebits,
      actual: totalDebits,
      difference: roundMoney(
        totalDebits - (matchesWithCharges ? purchasesDebits + financeCharges : purchasesDebits),
      ),
    });
  }

  if (printedCredits !== undefined) {
    checks.push({
      name: "Parsed credits = printed payments/credits",
      expected: printedCredits,
      actual: totalCredits,
      difference: roundMoney(totalCredits - printedCredits),
    });
  }

  for (const check of checks) check.ok = Math.abs(check.difference) <= TOLERANCE;
  const failed = checks.filter((check) => !check.ok);
  const rowsVerified = runningBalance && runningBalance.breaks.length === 0;

  if (rowsVerified && failed.length > 0) {
    const difference = Math.abs(failed[0].difference);
    warnings.push(
      `All ${runningBalance.checked} transactions are verified; only the summary box disagrees: ` +
        `the statement's printed summary differs from its transactions by ₹${formatMoney(difference)} ` +
        `(running balance verified row by row).`,
    );
  } else {
    for (const check of failed) {
      warnings.push(
        `${check.name} does not reconcile: off by ₹${formatMoney(Math.abs(check.difference))}.`,
      );
    }
  }
  if (runningBalance) warnings.push(...runningBalance.breaks, ...runningBalance.corrections);

  // The closing balance (last row of the Balance column) is what the card owes; when it equals
  // the total amount due the rows are complete, so small differences in the summary lines alone
  // don't fail the statement. A broken printed running balance always does.
  const closingBalance =
    runningBalance?.closingBalance ??
    (previousBalance === undefined
      ? null
      : roundMoney(previousBalance + totalDebits - totalCredits));
  const mainCheck =
    previousBalance !== undefined && totalAmountDue !== undefined ? checks[0] : null;
  const chainBroken = Boolean(runningBalance?.breaks.length);
  const status = chainBroken
    ? "MISMATCH"
    : mainCheck?.ok
      ? "OK"
      : checks.length === 0
        ? "UNVERIFIED"
        : failed.length > 0
          ? "MISMATCH"
          : "OK";
  return {
    status,
    totalDebits,
    totalCredits,
    closingBalance,
    checks,
    warnings,
    financeChargesAddedSeparately,
    runningBalance,
  };
}

export { checkRunningBalance, reconcile, removeDuplicateRows, totals };
