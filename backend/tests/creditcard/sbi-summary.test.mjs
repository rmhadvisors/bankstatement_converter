import assert from "node:assert/strict";
import test from "node:test";

import { buildCardStatement } from "../../src/creditcard/ccConverter.js";

// SBI Card: the ACCOUNT SUMMARY labels wrap over several lines ("Payments," above the row, "Purchases & Other" and a
// "( ` )" glyph line below it) and the five amounts sit on one line underneath, so the opening ("Previous Balance")
// used to be missed ("could not be read"). Made-up statement: invented holder, card number and amounts.
const at = (page, ...cells) => ({ pageNumber: page, text: cells.map(([, text]) => text).join(" "), items: cells.map(([x, text]) => ({ x, text })) });
const lines = [
  at(1, [19, "GSTIN of SBI Card : 00TESTGSTIN"]),
  at(1, [43, "SAMPLE HOLDER"], [324, "Credit Card Number"]),
  at(1, [318, "XXXX XXXX XXXX XX00"]),
  at(1, [323, "*Total Amount Due"], [396, "( ` )"]),
  at(1, [335, "1,500.00"]),
  at(1, [314, "**Minimum Amount Due"], [407, "( ` )"]),
  at(1, [343, "75.00"]),
  at(1, [43, "Credit Limit"], [173, "Cash Limit"], [332, "Statement Date"]),
  at(1, [63, "50,000.00"], [196, "10,000.00"], [334, "24 Jun 2026"]),
  at(1, [45, "Available Credit Limit"], [186, "Available Cash Limit"], [329, "Payment Due Date"]),
  at(1, [63, "48,500.00"], [196, "10,000.00"], [334, "14 Jul 2026"]),
  at(1, [185, "ACCOUNT SUMMARY"]),
  at(1, [250, "Additions"]),
  at(1, [124, "Payments,"]),
  at(1, [30, "Previous Balance"], [113, "Reversals & other"], [279, "Fee, Taxes &"], [357, "Total Outstanding"]),
  at(1, [192, "Purchases & Other"]),
  at(1, [51, "( ` )"], [130, "Credits"], [156, "( ` )"], [212, "Debits"], [236, "( ` )"], [274, "Interest Charges"], [328, "( ` )"], [380, "( ` )"]),
  at(1, [36, "1,000.00"], [119, "1,500.00"], [203, "2,000.00"], [289, "0.00"], [368, "1,500.00"]),
  at(1, [35, "Date"], [179, "Transaction Details"], [371, "Amount"], [403, "( ` )"]),
  at(1, [157, "for Statement Period: 25 May 26 to 24 Jun 26"]),
  at(1, [27, "04 Jun 26"], [71, "PAYMENT RECEIVED 000TEST"], [369, "1,500.00"], [415, "C"]),
  at(1, [27, "16 Jun 26"], [71, "SAMPLE SHOP"], [125, "CITYVILLE"], [180, "IN"], [369, "2,000.00"], [415, "D"]),
  at(1, [266, "Important Messages"]),
  at(1, [27, "Finance charges 3.75% p.m. (45% p.a.) on the outstanding amount"]),
];

test("SBI Card: the five ACCOUNT SUMMARY amounts are read from the wrapped label band and the statement reconciles", () => {
  const { summary, transactions, reconciliation } = buildCardStatement(lines);
  assert.equal(summary.previousBalance, 1000);
  assert.equal(summary.paymentsCredits, 1500);
  assert.equal(summary.purchasesDebits, 2000);
  assert.equal(summary.financeCharges, 0); // not the 3.75 of "3.75% p.m."
  assert.equal(summary.totalAmountDue, 1500);
  assert.equal(summary.minimumAmountDue, 75);
  assert.equal(summary.otherCredits, undefined); // "Reversals & other Credits" is not counted a second time
  assert.equal(transactions.length, 2);
  assert.equal(reconciliation.status, "OK");
  assert.deepEqual(reconciliation.warnings, []);
});
