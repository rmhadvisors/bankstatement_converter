import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";

// Step 3 of the layout guards: the generic parser reads amounts by the table's column positions. Synthetic
// statements (made-up numbers, no bank names), run through the real parseStatement().
// A text line as the PDF extractor delivers it: cells = [[x, text, width?], ...]
const at = (page, ...cells) => ({ pageNumber: page, text: cells.map(([, text]) => text).join(" "), items: cells.map(([x, text, width]) => ({ x, text, width })) });
const statement = (lines) => parseStatement({ lines, text: lines.map((l) => l.text).join("\n"), pageCount: Math.max(...lines.map((l) => l.pageNumber)), source: "pdf" });
const sides = (s) => s.transactions.map((t) => [t.withdrawal, t.deposit, t.balance]);

// An unrecognised layout: the header is not in the parser's list, so it is read by its column names.
const UNKNOWN_HEADER = (page) => at(page, [34, "Date"], [91, "Description"], [190, "Reference Number"], [309, "Value Date"], [360, "Debit"], [431, "Credit"], [502, "Balance"]);
// A listed layout ("Date Narration ..." is in the list): the same guards apply to it.
const LISTED_HEADER = (page) => at(page, [34, "Date"], [91, "Narration"], [190, "Reference Number"], [309, "Value Date"], [360, "Debit"], [431, "Credit"], [502, "Balance"]);
const row = (page, date, text, ref, side, amount, balance) => at(page, [29, date], [86, text], [185, ref], [304, date], [side === "debit" ? 360 : 431, amount], [502, balance]);

for (const [name, header] of [["unrecognised layout", UNKNOWN_HEADER], ["listed layout", LISTED_HEADER]]) {
  test(`a 12-digit number in the Reference column is never an amount (${name})`, () => {
    const s = statement([
      header(1),
      row(1, "01 Apr 2026", "UPI ONE", "120000000001", "credit", "480.00", "10,480.00"),
      row(1, "02 Apr 2026", "UPI TWO", "120000000002", "debit", "1,000.00", "9,480.00"),
    ]);
    assert.deepEqual(sides(s), [[null, 480, 10480], [1000, null, 9480]], "the reference numbers are not the debit");
    assert.equal(s.layout?.known, name === "unrecognised layout" ? false : undefined);
    if (name === "unrecognised layout") assert.deepEqual(s.layout.headers, ["Date", "Description", "Reference Number", "Value Date", "Debit", "Credit", "Balance"]);
  });
}

test('".80" (no leading zero) parses as 0.80, next to a reference that is not an amount', () => {
  const s = statement([
    UNKNOWN_HEADER(1),
    row(1, "01 Oct 2026", "SMS CHARGE", "SCREF00000000001", "debit", ".80", "199.20"),
    row(1, "01 Oct 2026", "GST", "BACB2600000000001R", "debit", ".14", "199.06"),
    row(1, "01 Oct 2026", "CASH HANDLING", "120000000003", "debit", "45.50", "153.56"),
  ]);
  assert.deepEqual(sides(s), [[0.8, null, 199.2], [0.14, null, 199.06], [45.5, null, 153.56]]);
});

test("a right-aligned amount lands in the right column, whatever its width", () => {
  // Amounts end at the same right edge but start at different x: "3,680.00" starts left of "55.00"; a narrow credit "5.00"
  // starts at x 538, which by its left edge is closer to the Balance header than to Deposit.
  const header = at(1, [40, "Date", 20], [144, "Narration", 40], [284, "Chq./Ref.No.", 60], [362, "Value Dt", 35], [405, "Withdrawal Amt.", 70], [491, "Deposit Amt.", 55], [564, "Closing Balance", 70]);
  const line = (date, text, ref, amount, balance) => at(1, [34, date], [72, text], [289, ref, 70], [362, date], amount, balance);
  const s = statement([
    header,
    line("01/04/26", "UPI-TEST ONE", "0000120000000005", [442, "3,680.00", 36], [595, "6,320.00", 36]),
    line("02/04/26", "UPI-TEST TWO", "0000120000000006", [538, "5.00", 18], [605, "6,325.00", 36]),
    line("03/04/26", "UPI-TEST THREE", "0000120000000007", [452, "55.00", 23], [605, "6,270.00", 36]),
    line("04/04/26", "UPI-TEST FOUR", "0000120000000008", [516, "24,000.00", 40], [595, "30,270.00", 36]),
  ]);
  assert.deepEqual(sides(s), [[3680, null, 6320], [null, 5, 6325], [55, null, 6270], [null, 24000, 30270]]);
});

test("page headers and footers do not leak into descriptions of an unrecognised layout", () => {
  const name = ["", "ALPHA", "BETA", "GAMMA"];
  const page = (n) => [
    at(n, [28, "TEST ACCOUNT HOLDER"]),
    UNKNOWN_HEADER(n),
    row(n, `0${n} Apr 2026`, `UPI ${name[n]}`, `12000000000${n}`, "credit", "10.00", `${n}0.00`),
    at(n, [86, `WRAPPED ${name[n]}`]),
    at(n, [33, `Page ${n} of 3`]),
  ];
  const s = statement([...page(1), ...page(2), ...page(3)]);
  assert.equal(s.layout.known, false);
  // (the generic parser keeps the reference and value-date text inside a description; only a layout parser separates them)
  s.transactions.forEach((t, i) => assert.ok(t.particulars.startsWith(`UPI ${name[i + 1]}`) && t.particulars.endsWith(`WRAPPED ${name[i + 1]}`), t.particulars));
  assert.ok(s.transactions.every((t) => !/TEST ACCOUNT HOLDER|Page \d of 3/.test(t.particulars)));
});
