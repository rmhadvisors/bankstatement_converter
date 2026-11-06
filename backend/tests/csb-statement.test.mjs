import assert from "node:assert/strict";
import test from "node:test";

import { isCsbLayout, parseCsbTransactions } from "../src/parsers/parsers/csbParser.js";

// CSB Bank text-layer statement: the date wraps ("15-APR-" then "2025" on the next line), every row prints both a
// debit and a credit ("0.00" in the unused one) and then the balance, the first row "B/F ..." is the opening balance,
// details wrap below with a hard break after "-". Made-up names and amounts.
const at = (page, ...cells) => ({ pageNumber: page, text: cells.map(([, text]) => text).join(" "), items: cells.map(([x, text]) => ({ x, text })) });
const lines = [
  at(1, [30, "CSB Bank sample"]),
  at(1, [36, "TRANS"], [80, "VALUE"], [122, "DETAILS"], [246, "REF NO."], [316, "DEBITS"], [385, "CREDITS"], [455, "BALANCE"]),
  at(1, [37, "Opening Balance"], [172, "Total Debit Amount"], [298, "Total Credit Amount"], [433, "Closing Balance"]),
  at(1, [37, "1,000.00"], [172, "300.00"], [298, "1,500.00"], [433, "2,200.00"]),
  at(1, [36, "01-APR-"], [80, "01-APR-"], [122, "B/F ..."], [359, "0.00"], [408, "1,000.00"], [512, "1,000.00"]),
  at(1, [36, "2025"], [80, "2025"]),
  at(1, [36, "15-APR-"], [80, "15-APR-"], [122, "SUCCESSFUL-"], [343, "250.00"], [428, "0.00"], [512, "750.00"]),
  at(1, [36, "2025"], [80, "2025"], [122, "WITHDRAWAL, DEMO-"]),
  at(1, [122, "SAMPLE LTD"]),
  at(1, [36, "25-APR-"], [80, "25-APR-"], [122, "SELF"], [278, "100054"], [350, "50.00"], [428, "0.00"], [512, "700.00"]),
  at(1, [36, "2025"], [80, "2025"]),
  at(1, [528, "Page 1 of 2"]),
  at(2, [36, "TRANS"], [80, "VALUE"], [122, "DETAILS"], [246, "REF NO."], [316, "DEBITS"], [385, "CREDITS"], [455, "BALANCE"]),
  at(2, [36, "02-MAY-"], [80, "02-MAY-"], [122, "SALARY FOR"], [359, "0.00"], [408, "1,500.00"], [512, "2,200.00"]),
  at(2, [36, "2025"], [80, "2025"], [122, "THE MONTH"]),
  at(2, [250, "****** END OF STATEMENT ******"]),
];

test("CSB layout: wrapped dates, both amounts per row, B/F opening, details wrapped below", () => {
  assert.ok(isCsbLayout(lines));
  const { transactions, printedTotals, openingBalance, reconciliationIssues } = parseCsbTransactions(lines);
  assert.deepEqual(
    transactions.map((t) => [t.date.toISOString().slice(0, 10), t.particulars, t.chequeNo, t.withdrawal, t.deposit, t.balance]),
    [
      ["2025-04-15", "SUCCESSFUL-WITHDRAWAL, DEMO-SAMPLE LTD", null, 250, null, 750],
      ["2025-04-25", "SELF", "100054", 50, null, 700],
      ["2025-05-02", "SALARY FOR THE MONTH", null, null, 1500, 2200],
    ],
  );
  assert.equal(openingBalance, 1000);
  assert.deepEqual([printedTotals.withdrawal, printedTotals.deposit, printedTotals.closingBalance], [300, 1500, 2200]);
  assert.deepEqual(reconciliationIssues, []);
});

test("CSB layout: a row with neither or both of debit and credit is reported, not guessed", () => {
  const bad = [...lines];
  bad.splice(9, 1, at(1, [36, "25-APR-"], [80, "25-APR-"], [122, "SELF"], [350, "50.00"], [428, "10.00"], [512, "700.00"]));
  const { transactions, reconciliationIssues } = parseCsbTransactions(bad);
  assert.equal(transactions.length, 2);
  assert.match(reconciliationIssues[0], /25-apr 2025 prints both a debit and a credit and was left out/);
});
