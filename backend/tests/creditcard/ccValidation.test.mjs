import assert from "node:assert/strict";
import test from "node:test";

import {
  checkRunningBalance,
  reconcile,
  removeDuplicateRows,
} from "../../src/creditcard/ccValidation.js";

const day = (d) => new Date(Date.UTC(2024, 2, d));
const row = (d, description, amount, type = "debit", extra = {}) => ({
  date: day(d),
  description,
  amount,
  type,
  page: 1,
  ...extra,
});

test("ccValidation: previous + debits - credits = total due reconciles", () => {
  const rows = [row(1, "SHOP", 1000), row(2, "PAYMENT", 3000, "credit"), row(3, "FUEL", 500.5)];
  const result = reconcile({ previousBalance: 5000, totalAmountDue: 3500.5 }, rows);
  assert.equal(result.status, "OK");
  assert.equal(result.totalDebits, 1500.5);
  assert.equal(result.totalCredits, 3000);
  assert.equal(result.checks[0].difference, 0);
  assert.deepEqual(result.warnings, []);
});

test("ccValidation: within ₹1 is rounding, more is a mismatch with the difference listed", () => {
  const rows = [row(1, "SHOP", 1000)];
  assert.equal(reconcile({ previousBalance: 0, totalAmountDue: 1000.9 }, rows).status, "OK");

  const result = reconcile({ previousBalance: 0, totalAmountDue: 1250 }, rows);
  assert.equal(result.status, "MISMATCH");
  assert.equal(result.checks[0].difference, -250);
  assert.match(result.warnings[0], /off by ₹250\.00/);
});

test("ccValidation: finance charges printed only in the summary are added", () => {
  const rows = [row(1, "SHOP", 1000)];
  const result = reconcile({ previousBalance: 0, totalAmountDue: 1199, financeCharges: 199 }, rows);
  assert.equal(result.status, "OK");
  assert.equal(result.financeChargesAddedSeparately, true);
});

test("ccValidation: printed debit/credit totals are cross-checked", () => {
  const rows = [row(1, "SHOP", 1000), row(2, "PAYMENT", 500, "credit")];
  const result = reconcile(
    { previousBalance: 0, totalAmountDue: 500, purchasesDebits: 1200, paymentsCredits: 500 },
    rows,
  );
  // The closing balance (0 + 1000 - 500) equals the total due, so the statement is OK; the
  // printed-purchases difference is still reported.
  assert.equal(result.status, "OK");
  assert.equal(result.closingBalance, 500);
  assert.equal(result.checks.find((check) => /^Parsed debits/.test(check.name)).ok, false);
  assert.equal(result.checks.find((check) => /^Parsed credits/.test(check.name)).ok, true);
  assert.match(result.warnings.join(" "), /purchases\/debits does not reconcile: off by ₹200\.00/);

  const off = reconcile({ previousBalance: 0, totalAmountDue: 400, purchasesDebits: 1200 }, rows);
  assert.equal(off.status, "MISMATCH", "closing balance != total due");
});

test("ccValidation: a missing summary is UNVERIFIED with a warning, never a silent pass", () => {
  const result = reconcile({}, [row(1, "SHOP", 10)]);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.warnings.length, 1);
});

test("ccValidation: page-break duplicates go, genuine repeats stay", () => {
  const coffee = row(5, "STARBUCKS", 300);
  const { transactions, removed } = removeDuplicateRows([
    coffee,
    { ...coffee }, // same page, no ref: two real coffees
    { ...coffee, page: 2 }, // top of the next page: repeated by the page break
    row(6, "UBER", 200, "debit", { refNo: "111" }),
    row(6, "UBER", 200, "debit", { refNo: "222" }), // same trip price, different ref: genuine
    row(6, "UBER", 200, "debit", { refNo: "111", page: 3 }), // same ref again: duplicate
  ]);
  assert.equal(removed, 2);
  assert.deepEqual(
    transactions.map((t) => `${t.description}:${t.refNo ?? ""}:${t.page}`),
    ["STARBUCKS::1", "STARBUCKS::1", "UBER:111:1", "UBER:222:1"],
  );
});

test("ccValidation: running balance fixes a misread Debit/Credit and reports real breaks", () => {
  const rows = [
    row(1, "SHOP", 100, "debit", { balance: 1100 }),
    row(2, "REFUND", 50, "debit", { balance: 1050 }), // printed balance only fits a credit
    row(3, "FUEL", 200, "debit", { balance: 1300 }), // 1050 + 200 = 1250: a break
    row(4, "CAFE", 10, "debit", { balance: 1310 }), // chain resyncs on the printed 1300
  ];
  const chain = checkRunningBalance({ previousBalance: 1000 }, rows);
  assert.equal(rows[1].type, "credit");
  assert.equal(chain.corrections.length, 1);
  assert.equal(chain.breaks.length, 1);
  assert.match(chain.breaks[0], /Row 3 .*FUEL.*printed balance ₹1,300\.00, expected ₹1,250\.00/);
  assert.equal(chain.closingBalance, 1310);

  const result = reconcile({ previousBalance: 1000, totalAmountDue: 1310 }, rows, chain);
  assert.equal(
    result.status,
    "MISMATCH",
    "a break is never OK even when the totals happen to agree",
  );
  assert.equal(checkRunningBalance({}, [row(1, "NO BALANCE COLUMN", 5)]), null);
});
