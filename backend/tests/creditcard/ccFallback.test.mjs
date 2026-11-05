import assert from "node:assert/strict";
import test from "node:test";

import { buildCardStatement } from "../../src/creditcard/ccConverter.js";

// Step 2: a printed-total mismatch is reported with the exact difference, and a layout no issuer parser reads is
// read by its header columns, reconciled and labelled -- never a bare "No transactions could be read" when the
// text has dated rows with amounts. Synthetic statements: invented cardholder, card number, merchants, amounts.
const iso = (date) => date?.toISOString().slice(0, 10);
const at = (page, ...cells) => ({ pageNumber: page, text: cells.map(([, text]) => text).join(" "), items: cells.map(([x, text]) => ({ x, text })) });
const row = (page, date, description, amount, word) => at(page, [52, date], [152, description], [352, amount], [452, word]);

// opening 4,000.00 + debits 4,384.50 - credits 3,384.50 = 5,000.00 (the printed total due unless overridden)
const statement = ({ totalDue = "₹ 5,000.00", amountHeader = "Amount (INR)", dateOf = (d) => d, rows } = {}) => [
  at(1, [294, "Axis Bank Select Credit Card Monthly Statement"]),
  at(1, [48, "TEST CARDHOLDER"]),
  at(1, [48, "SAMPLEVILLE 400001 Credit Card Number: 4000XXXXXXXX0001"]),
  at(1, [261, "Payment Summary"]),
  at(1, [55, "Total Payment Due"], [222, "Minimum Payment Due"], [388, "Payment Due Date"]),
  at(1, [55, totalDue], [222, "₹ 500.00"], [388, "03 May '26"]),
  at(1, [55, "Selected Statement Month"], [222, "Credit Limit"], [388, "Opening Balance"]),
  at(1, [55, "Apr 2026"], [222, "₹ 50,000.00"], [388, "₹ 4,000.00"]),
  at(1, [254, "Transaction Summary"]),
  at(1, [52, "Date"], [152, "Transaction Details"], [352, amountHeader], [452, "Debit/Credit"]),
  ...(rows ?? [
    row(1, dateOf("13 Apr '26"), "TEST INTEREST", "₹ 1,100.50", "Debit"),
    row(1, dateOf("12 Apr '26"), "SAMPLE MART,CITYVILLE", "₹ 1,234.00", "Debit"),
    row(1, dateOf("10 Apr '26"), "TEST REFUND", "₹ 100.00", "Credit"),
    at(1, [528, "Page 1 of 2"]),
    row(2, dateOf("05 Apr '26"), "DEMO PETROL PUMP,TOWNSHIP", "₹ 2,050.00", "Debit"),
    row(2, dateOf("20 Mar '26"), "TEST PAYMENT #AB12CD34", "₹ 3,284.50", "Credit"),
    at(2, [240, "**End of Transaction Summary**"]),
    at(2, [528, "Page 2 of 2"]),
  ]),
];

test("rule 3: a total that does not match opening + debits - credits is a MISMATCH with the exact difference, never a silent pass", () => {
  const { reconciliation } = buildCardStatement(statement({ totalDue: "₹ 5,010.40" }));
  assert.equal(reconciliation.status, "MISMATCH");
  assert.equal(reconciliation.checks[0].difference, -10.4);
  assert.match(reconciliation.warnings[0], /off by ₹10\.40 \(calculated ₹5,000\.00, printed ₹5,010\.40\)/);
  // and it still passes when the printed total is right
  assert.equal(buildCardStatement(statement()).reconciliation.status, "OK");
});

test("rule 4: an unrecognised table header is read by its columns; matching totals give OK with a visible note naming the headers", () => {
  // "Charge (INR)" instead of "Amount (INR)": the Axis path is not switched on, so no issuer parser reads a row.
  const { transactions, reconciliation } = buildCardStatement(statement({ amountHeader: "Charge (INR)" }));
  assert.deepEqual(
    transactions.map((t) => [iso(t.date), t.description, t.amount, t.type, t.page]),
    [
      ["2026-04-13", "TEST INTEREST", 1100.5, "debit", 1],
      ["2026-04-12", "SAMPLE MART,CITYVILLE", 1234, "debit", 1],
      ["2026-04-10", "TEST REFUND", 100, "credit", 1],
      ["2026-04-05", "DEMO PETROL PUMP,TOWNSHIP", 2050, "debit", 2],
      ["2026-03-20", "TEST PAYMENT #AB12CD34", 3284.5, "credit", 2],
    ],
  );
  assert.equal(reconciliation.status, "OK");
  assert.match(reconciliation.warnings[0], /^Layout not recognised \(headers found: Date, Transaction Details, Charge \(INR\), Debit\/Credit\) - read by its header columns and verified by the printed totals only; send this PDF/);
});

test("rule 4: an unrecognised layout whose totals do not match is not OK: the headers found and the exact difference are reported", () => {
  const { reconciliation } = buildCardStatement(statement({ amountHeader: "Charge (INR)", totalDue: "₹ 5,010.40" }));
  assert.equal(reconciliation.status, "MISMATCH");
  assert.match(reconciliation.warnings[0], /^Layout not recognised \(headers found: Date, Transaction Details, Charge \(INR\), Debit\/Credit\) and the result does not reconcile/);
  assert.ok(reconciliation.warnings.some((w) => /off by ₹10\.40/.test(w)));
});

test("rule 4: a line the header-column reader cannot read is listed, and the statement is not OK even if the totals match", () => {
  // the last row has two amounts, so its amount is ambiguous; the row is left out and named
  const rows = [
    row(1, "13 Apr '26", "TEST INTEREST", "₹ 1,100.50", "Debit"),
    row(1, "12 Apr '26", "SAMPLE MART,CITYVILLE", "₹ 900.00", "Debit"),
    row(1, "10 Apr '26", "TEST REFUND", "₹ 1,000.50", "Credit"),
    at(1, [52, "05 Apr '26"], [152, "TEST TWO AMOUNTS"], [352, "₹ 10.00"], [400, "₹ 20.00"], [452, "Debit"]),
  ];
  const { transactions, reconciliation } = buildCardStatement(statement({ amountHeader: "Charge (INR)", rows }));
  assert.equal(transactions.length, 3);
  assert.equal(reconciliation.checks[0].difference, 0, "the three rows read do reconcile");
  assert.equal(reconciliation.status, "UNVERIFIED", "but a line was left out, so it is not a plain OK");
  assert.match(reconciliation.warnings[0], /the totals match, but 1 dated line without exactly one amount in a transaction column \(first: "05 Apr '26 TEST TWO AMOUNTS ₹ 10\.00 ₹ 20\.00 Debit"\)\. Some transactions may be missing/);
});

test("rule 4: dated lines with amounts that cannot be read at all give a specific error, not the bare one; no such lines keeps the old error", () => {
  // dates written 13.Apr.26: no reader knows that shape
  const unknown = statement({ rows: [row(1, "13.Apr.26", "TEST INTEREST", "₹ 1,100.50", "Debit"), row(1, "12.Apr.26", "SAMPLE MART", "₹ 1,234.00", "Debit")] });
  assert.throws(
    () => buildCardStatement(unknown),
    (error) =>
      error.code === "LAYOUT_NOT_RECOGNISED" &&
      /This Axis Bank statement has 2 dated line\(s\) with amounts, but none could be read: 2 dated lines with a date shape this reader does not know \(first: "13\.Apr\.26 TEST INTEREST ₹ 1,100\.50 Debit"\)\. Headers found: Date, Transaction Details, Amount \(INR\), Debit\/Credit/.test(error.message),
  );
  // no dated row with an amount at all: nothing to read, the original message stays
  assert.throws(
    () => buildCardStatement(statement({ rows: [at(1, [528, "Page 1 of 1"])] })),
    (error) => error.code === "NO_TRANSACTIONS_FOUND" && /No transactions could be read from this Axis Bank credit card statement\./.test(error.message),
  );
});
