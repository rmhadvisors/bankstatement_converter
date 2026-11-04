import assert from "node:assert/strict";
import test from "node:test";

import { buildValidationReport, correctDebitCreditByBalance, reviewStatus } from "../src/parsers/validation.js";

// Step 2 of the layout guards: validation.js. All statements here are synthetic (made-up numbers).
const day = (d) => new Date(Date.UTC(2026, 7, d));
const row = (d, particulars, withdrawal, deposit, balance) => ({ date: day(d), particulars, withdrawal, deposit, balance });
const review = (statement) => {
  const full = { logs: [], printedTotals: null, totals: {}, ...statement };
  full.reconciliation = buildValidationReport(full, []);
  return { review: reviewStatus(full), report: full.reconciliation, statement: full };
};

test("balance-chain corrections: one line per kind with the count, the first row and the sum of the amounts, never one per row", () => {
  const transactions = [
    row(1, "OPENING", null, null, 1000),
    row(2, "A", null, 50, 950), // printed credit, balance fell: credit -> debit
    row(3, "B", null, 100, 850), // credit -> debit
    row(4, "C", 30, null, 880), // printed debit, balance rose: debit -> credit
    row(5, "D", null, 25, 825), // credit -> debit (the balance fell by 55: the corrected amount is 55, not the printed 25)
    row(6, "E", 10, null, 815), // fine
  ];
  correctDebitCreditByBalance(transactions);
  const { review: result } = review({ transactions });
  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.reasons, [
    "3 rows: printed credit changed to debit to fit the balance; please verify against the PDF (first: row 2; amounts affected 205.00)",
    "1 row: printed debit changed to credit to fit the balance; please verify against the PDF (first: row 4; amounts affected 30.00)",
  ]);
});

test("status rules are unchanged: reasons empty = ok, no extra keys on a clean statement", () => {
  const { review: clean } = review({ transactions: [row(1, "OPENING", null, null, 1000), row(2, "A", 100, null, 900), row(3, "B", null, 50, 950)] });
  assert.deepEqual(clean, { status: "ok", reasons: [] });
  const { report } = review({ transactions: [row(1, "OPENING", null, null, 1000), row(2, "A", 100, null, 900)] });
  assert.equal("rejectedAmounts" in report, false, "a clean report is byte-identical to before");
});

test("rule 6: a reference number read as a debit is rejected, flagged once, and the opening balance is not derived from that row", () => {
  const transactions = [
    row(1, "UPI CR", 120000000001, null, 64000.00), // the reference number landed in the debit column
    row(2, "UPI CR", null, 4350, 68350.00),
    row(3, "UPI CR", 120000000002, null, 68000),
  ];
  const { review: result, report } = review({ transactions });
  assert.equal(result.status, "needs_review");
  assert.equal(report.openingBalance, null, "not derived from a row whose amount failed validation");
  assert.deepEqual(report.rejectedAmounts.map((item) => [item.row, item.field]), [[1, "withdrawal"], [3, "withdrawal"]]);
  assert.ok(
    result.reasons.includes("2 rows: debit amount rejected: has more than 11 digits before the decimal point (first: row 1; amounts affected 2,40,00,00,00,003.00)"),
    result.reasons.join(" | "),
  );
});

test("rule 4: the printed opening balance is used when the statement has one, otherwise it is derived from the first row", () => {
  const transactions = [row(1, "A", 100, null, 900), row(2, "B", null, 50, 950)];
  assert.equal(review({ transactions, printedTotals: { source: "printed", withdrawal: 100, deposit: 50, closingBalance: 950, openingBalance: 1000 } }).report.openingBalance, 1000);
  assert.equal(review({ transactions }).report.openingBalance, 1000, "derived: 900 + 100");
  // a printed opening that the first row contradicts shows up as a balance break, it does not get overridden
  const wrong = review({ transactions, printedTotals: { source: "printed", withdrawal: 100, deposit: 50, closingBalance: 950, openingBalance: 5000 } });
  assert.equal(wrong.report.openingBalance, 5000);
  assert.equal(wrong.review.status, "needs_review");
});

test("rule 5: the printed Dr/Cr counts are checked when the parser read them", () => {
  const transactions = [row(1, "OPENING", null, null, 1000), row(2, "A", 100, null, 900), row(3, "B", null, 50, 950)];
  const printed = { source: "printed", withdrawal: 100, deposit: 50, closingBalance: 950, openingBalance: 1000 };
  assert.equal(review({ transactions, printedTotals: { ...printed, debitCount: 1, creditCount: 1 } }).review.status, "ok");
  const { review: result } = review({ transactions, printedTotals: { ...printed, debitCount: 2, creditCount: 1 } });
  assert.deepEqual(result.reasons, ["The statement prints 2 debits but 1 were read."]);
});

test("rule 7: an unrecognised layout is never ok without a passing check", () => {
  const layout = { known: false, headers: ["Date", "Narration", "Debit", "Credit", "Balance"] };
  const good = [row(1, "OPENING", null, null, 1000), row(2, "A", 100, null, 900), row(3, "B", null, 50, 950)];

  // chain passes: allowed, with a visible note (also in the logs) and no reason
  const passed = review({ transactions: good, layout });
  assert.equal(passed.review.status, "ok");
  assert.deepEqual(passed.review.reasons, []);
  assert.deepEqual(passed.review.notes, ["Layout not recognised - verified by balance chain only; send this PDF to add it as a known layout"]);
  assert.ok(passed.statement.logs.some((log) => log.level === "info" && /Layout not recognised/.test(log.message)));

  // chain fails: needs_review, headers found, then the specific reasons
  const broken = review({ transactions: [row(1, "OPENING", null, null, 1000), row(2, "A", 100, null, 900), row(3, "B", null, 50, 1000)], layout });
  assert.equal(broken.review.status, "needs_review");
  assert.match(broken.review.reasons[0], /^Layout not recognised \(headers found: Date, Narration, Debit, Credit, Balance\) and the result does not reconcile/);
  assert.ok(broken.review.reasons.some((reason) => /Running balance breaks on 1 row/.test(reason)));

  // printed summary does not match: needs_review
  const mismatch = review({ transactions: good, layout, printedTotals: { source: "printed", withdrawal: 999, deposit: 50, closingBalance: 950 } });
  assert.equal(mismatch.review.status, "needs_review");
  assert.ok(mismatch.review.reasons.some((reason) => /do not match the printed total/.test(reason)));

  // no balance column at all: nothing to verify against
  const noBalances = review({ transactions: [row(1, "A", 100, null, null), row(2, "B", null, 50, null)], layout });
  assert.equal(noBalances.review.status, "needs_review");
  assert.match(noBalances.review.reasons[0], /no balance column to verify/);

  // a known layout (or no layout info) is untouched
  assert.deepEqual(review({ transactions: good, layout: { known: true, headers: [] } }).review, { status: "ok", reasons: [] });
  assert.deepEqual(review({ transactions: good }).review, { status: "ok", reasons: [] });
});
