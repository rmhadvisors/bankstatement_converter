import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertCreditCardStatement } from "../../src/creditcard/ccConverter.js";

// Real credit card statements are customer data: the PDFs and their expected figures live in the git-ignored
// tests/fixtures/bank/ (client-statements.json, key "cards"). Each case skips, with the missing name in the test
// title, when its PDF or the JSON is absent.
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "bank");
const specPath = join(dir, "client-statements.json");
const cards = existsSync(specPath) ? (JSON.parse(readFileSync(specPath, "utf8")).cards ?? []) : [];
const iso = (date) => date?.toISOString().slice(0, 10);
const kind = (t) => String(t.type).toLowerCase();
const sum = (rows) => Math.round(rows.reduce((total, t) => total + t.amount, 0) * 100) / 100;
const shape = (t) => [iso(t.date), t.description, t.amount, t.type];

if (!cards.length) test("real card statements: expected figures in client-statements.json (cards)", { skip: "needs fixtures/bank/client-statements.json with a \"cards\" list" }, () => {});

// c: { file, issuer, rows, byPage, debitRows, creditRows, debits, credits, opening, totalDue, first, last, pageTwoFirst, credits: [...] }
for (const c of cards) {
  const path = join(dir, c.file);
  test(`real card statement ${c.file}: every row, totals and the printed payment summary`, { skip: !existsSync(path) && `needs fixtures/bank/${c.file}` }, async () => {
    const { summary, transactions, reconciliation } = await convertCreditCardStatement(path);
    const debits = transactions.filter((t) => kind(t) === "debit");
    const credits = transactions.filter((t) => kind(t) === "credit");

    assert.equal(transactions.length, c.rows);
    assert.deepEqual([1, 2].map((p) => transactions.filter((t) => t.page === p).length), c.byPage);
    assert.deepEqual([debits.length, sum(debits), credits.length, sum(credits)], [c.debitRows, c.debits, c.creditRows, c.credits]);
    assert.deepEqual(shape(transactions[0]), [c.first.date, c.first.description, c.first.amount, c.first.type]);
    assert.deepEqual(shape(transactions.at(-1)), [c.last.date, c.last.description, c.last.amount, c.last.type]);
    assert.deepEqual(shape(transactions.find((t) => t.page === 2)), [c.pageTwoFirst.date, c.pageTwoFirst.description, c.pageTwoFirst.amount, c.pageTwoFirst.type], "the first row after the page break is kept");
    // the listed credits, in order: same date and amount, and a description that starts with the expected text
    assert.equal(credits.length, c.creditList.length);
    credits.forEach((t, i) => {
      const want = c.creditList[i];
      assert.deepEqual([iso(t.date), t.amount], [want.date, want.amount]);
      assert.ok(t.description.startsWith(want.description), `credit ${i + 1}: "${t.description}" should start with "${want.description}"`);
    });
    assert.ok(transactions.every((t) => !/page \d|end of|summary/i.test(t.description)), "no footer text in a description");
    assert.deepEqual([summary.previousBalance, summary.totalAmountDue], [c.opening, c.totalDue]);
    assert.equal(reconciliation.status, "OK");
    assert.equal(reconciliation.checks[0].difference, 0, "opening + debits - credits = the printed Total Payment Due");
  });
}
