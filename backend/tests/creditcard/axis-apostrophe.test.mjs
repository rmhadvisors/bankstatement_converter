import assert from "node:assert/strict";
import test from "node:test";

import { buildCardStatement } from "../../src/creditcard/ccConverter.js";
import { parseCcDate } from "../../src/creditcard/ccCommon.js";

// Axis Bank Select card layout with "13 Apr '26" dates, "₹ 1,12,345.67" amounts and the direction as the WORD
// Debit / Credit after the amount (columns: Date | Transaction Details | Amount (INR) | Debit/Credit, no balance
// column). Synthetic page: invented cardholder, card number and merchants, made-up amounts.
const iso = (date) => date?.toISOString().slice(0, 10);
const at = (page, ...cells) => ({ pageNumber: page, text: cells.map(([, text]) => text).join(" "), items: cells.map(([x, text]) => ({ x, text })) });
const row = (page, date, description, amount, word) => at(page, [52, date], [152, description], [352, amount], [452, word]);

const page1 = [
  at(1, [294, "Axis Bank Select Credit Card Monthly Statement"]),
  at(1, [48, "TEST CARDHOLDER"]),
  at(1, [48, "1 SAMPLE STREET, NOWHERE"]),
  at(1, [48, "SAMPLEVILLE 400001 Credit Card Number: 4000XXXXXXXX0001"]),
  at(1, [261, "Payment Summary"]),
  at(1, [55, "Total Payment Due"], [222, "Minimum Payment Due"], [388, "Payment Due Date"]),
  at(1, [55, "₹ 5,000.00"], [222, "₹ 500.00"], [388, "03 May '26"]),
  at(1, [55, "Selected Statement Month"], [222, "Credit Limit"], [388, "Opening Balance"]),
  at(1, [55, "Apr 2026"], [222, "₹ 50,000.00"], [388, "₹ 4,000.00"]),
  at(1, [254, "Transaction Summary"]),
  at(1, [52, "Date"], [152, "Transaction Details"], [352, "Amount (INR)"], [452, "Debit/Credit"]),
  row(1, "13 Apr '26", "TEST INTEREST", "₹ 1,100.50", "Debit"),
  row(1, "12 Apr '26", "SAMPLE MART,CITYVILLE", "₹ 1,234.00", "Debit"),
  row(1, "10 Apr '26", "TEST REFUND", "₹ 100.00", "Credit"),
  row(1, "09 Apr '26", "TEST ADJUSTMENT", "₹ -50.00", "Debit"), // a printed minus sign: the word Debit decides
  at(1, [528, "Page 1 of 2"]),
];
// Page 2 has no repeated header: its first row must still be read.
const page2 = [
  row(2, "05 Apr '26", "DEMO PETROL PUMP,TOWNSHIP", "₹ 2,000.00", "Debit"),
  row(2, "04 Apr '26", "TEST ONLINE STORE,MUMBAI", "₹ 1,12,481.46", "Debit"),
  row(2, "20 Mar '26", "TEST PAYMENT #AB12CD34", "₹ 1,12,345.67", "Credit"),
  row(2, "16 Mar '26", "TEST CASHBACK", "₹ 3,370.29", "Credit"),
  row(2, "13 Mar '26", "TEST ADJ CREDIT", "₹ 50.00", "Credit"),
  at(2, [240, "**End of Transaction Summary**"]),
  at(2, [528, "Page 2 of 2"]),
];

test("Axis Select apostrophe layout: dates, ₹ amounts, direction word, page break, summary and reconciliation", () => {
  const { summary, transactions, reconciliation } = buildCardStatement([...page1, ...page2]);

  assert.equal(transactions.length, 9);
  assert.deepEqual([1, 2].map((p) => transactions.filter((t) => t.page === p).length), [4, 5]);
  assert.deepEqual(
    transactions.map((t) => [iso(t.date), t.description, t.amount, t.type]),
    [
      ["2026-04-13", "TEST INTEREST", 1100.5, "debit"],
      ["2026-04-12", "SAMPLE MART,CITYVILLE", 1234, "debit"],
      ["2026-04-10", "TEST REFUND", 100, "credit"],
      ["2026-04-09", "TEST ADJUSTMENT", 50, "debit"],
      ["2026-04-05", "DEMO PETROL PUMP,TOWNSHIP", 2000, "debit"],
      ["2026-04-04", "TEST ONLINE STORE,MUMBAI", 112481.46, "debit"],
      ["2026-03-20", "TEST PAYMENT #AB12CD34", 112345.67, "credit"],
      ["2026-03-16", "TEST CASHBACK", 3370.29, "credit"],
      ["2026-03-13", "TEST ADJ CREDIT", 50, "credit"],
    ],
  );
  assert.ok(transactions.every((t) => !/page \d|end of|summary/i.test(t.description)), "no footer text in a description");

  // amounts come from the rows only, never from the Payment Summary box or the masked card number
  assert.deepEqual(
    [summary.previousBalance, summary.totalAmountDue, summary.minimumAmountDue, summary.creditLimit, iso(summary.paymentDueDate), summary.cardLast4],
    [4000, 5000, 500, 50000, "2026-05-03", "0001"],
  );
  assert.equal(reconciliation.status, "OK");
  assert.equal(reconciliation.totalDebits, 116865.96);
  assert.equal(reconciliation.totalCredits, 115865.96);
  assert.equal(reconciliation.checks[0].difference, 0, "4,000.00 + debits - credits = 5,000.00 = the printed Total Payment Due");
});

test("card dates written dd Mon 'yy: year = 2000 + yy, straight or curly apostrophe, impossible dates rejected", () => {
  assert.equal(iso(parseCcDate("13 Apr '26")), "2026-04-13");
  assert.equal(iso(parseCcDate("03 May ’26")), "2026-05-03");
  assert.equal(iso(parseCcDate("1 Jan '09")), "2009-01-01");
  assert.equal(parseCcDate("31 Feb '26"), null);
  assert.equal(iso(parseCcDate("12 Mar 24")), "2024-03-12", "the older shapes still parse");
  assert.equal(iso(parseCcDate("12-Mar-2024")), "2024-03-12");
});
