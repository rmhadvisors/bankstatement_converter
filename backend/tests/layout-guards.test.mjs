import assert from "node:assert/strict";
import test from "node:test";

import {
  columnBands,
  columnOfItem,
  describeGroup,
  findInsaneAmounts,
  inAmountColumns,
  isAmountText,
  isSaneAmount,
  joinWrappedLines,
  normalizeDescription,
  stripPageFurniture,
} from "../src/parsers/guards.js";

// Header of the Bassein Catholic account statement (left-aligned columns) and of HDFC (right-aligned, widths known).
const bccbHeader = columnBands([
  { x: 34, text: "Transaction" }, { x: 91, text: "Description" }, { x: 190, text: "Reference Number" },
  { x: 309, text: "Value Date" }, { x: 360, text: "Debit" }, { x: 431, text: "Credit" }, { x: 502, text: "Balance" },
]);
const hdfcHeader = columnBands([
  { x: 40, width: 20, text: "Date" }, { x: 144, width: 40, text: "Narration" }, { x: 284, width: 60, text: "Chq./Ref.No." },
  { x: 362, width: 35, text: "Value Dt" }, { x: 405, width: 70, text: "Withdrawal Amt." }, { x: 491, width: 55, text: "Deposit Amt." }, { x: 564, width: 70, text: "Closing Balance" },
]);

test("rule 1: amount shape needs two decimals, '.80' counts, a 12-digit reference never does", () => {
  for (const ok of ["480.00", "4,350.00", "1,234,567.89", ".80", ".14", "10,495.06", "-35,740.00", "1,000.00 Cr."]) assert.ok(isAmountText(ok), ok);
  for (const no of ["120000000001", "BACB2600000000001R", "1,234.5", "12", "01 Apr 2026", "SCREF00000000001", "1.234.56"]) assert.ok(!isAmountText(no), no);
});

test("rule 1: only Debit / Credit / Balance columns hold amounts (left-aligned layout)", () => {
  assert.equal(columnOfItem({ x: 185, text: "120000000001" }, bccbHeader), "reference");
  assert.ok(!inAmountColumns({ x: 185, text: "120000000001" }, bccbHeader), "a reference number is not an amount");
  assert.ok(!inAmountColumns({ x: 185, text: "480.00" }, bccbHeader), "an amount-shaped number in the reference column is not an amount");
  assert.equal(columnOfItem({ x: 360, text: ".80" }, bccbHeader), "debit");
  assert.equal(columnOfItem({ x: 431, text: "480.00" }, bccbHeader), "credit");
  assert.equal(columnOfItem({ x: 502, text: "10,495.06" }, bccbHeader), "balance");
  assert.ok(inAmountColumns({ x: 360, text: ".80" }, bccbHeader));
  assert.equal(columnOfItem({ x: 700, text: "9.00" }, bccbHeader), null, "far from every header: unclaimed");
});

test("rule 1: right-aligned amounts are assigned by their right edge when widths are known", () => {
  // "55.00" starts at x 452 (right edge 475), the Withdrawal header's right edge is 475; by left edge alone it would be closer to Deposit.
  assert.equal(columnOfItem({ x: 452, width: 23, text: "55.00" }, hdfcHeader), "debit");
  assert.equal(columnOfItem({ x: 442, width: 36, text: "3,680.00" }, hdfcHeader), "debit");
  assert.equal(columnOfItem({ x: 526, width: 27, text: "525.00" }, hdfcHeader), "credit");
  assert.equal(columnOfItem({ x: 605, width: 27, text: "570.79" }, hdfcHeader), "balance");
  assert.equal(columnOfItem({ x: 289, width: 70, text: "0000120000000005" }, hdfcHeader), "reference");
});

test("rule 6: more than 11 integer digits, or a movement over 100 x the largest balance, is rejected", () => {
  assert.ok(isSaneAmount(99999999999.99).ok);
  assert.ok(!isSaneAmount(120000000001).ok, "12 digits");
  assert.ok(!isSaneAmount(120000000064.06, { kind: "balance" }).ok);
  assert.ok(isSaneAmount(5000, { maxBalance: 100 }).ok, "exactly 50 x is fine");
  assert.ok(isSaneAmount(10000, { maxBalance: 100 }).ok, "exactly 100 x is the limit");
  assert.ok(!isSaneAmount(10000.01, { maxBalance: 100 }).ok);
  assert.ok(isSaneAmount(10000.01, { kind: "balance", maxBalance: 100 }).ok, "the bound applies to debits and credits only");

  const rows = [
    { withdrawal: null, deposit: 480, balance: 10495.06 },
    { withdrawal: 120000000001, deposit: null, balance: 10015.06 }, // a reference number read as a debit
    { withdrawal: null, deposit: 7000000, balance: 7000000 + 10015.06 }, // 100 x the next-largest balance is exceeded by nothing here
  ];
  const found = findInsaneAmounts(rows);
  assert.deepEqual(found.map((f) => [f.row, f.field]), [[2, "withdrawal"]]);
  assert.match(found[0].reason, /11 digits/);
});

test("rule 3: page headers, page numbers and the summary box go; repeated first rows and wrapped description lines stay", () => {
  const at = (...cells) => ({ text: cells.map(([, text]) => text).join(" "), items: cells.map(([x, text]) => ({ x, text })) });
  const header = at([34, "Transaction"], [91, "Description"], [190, "Reference Number"], [309, "Value Date"], [360, "Debit"], [431, "Credit"], [502, "Balance"]);
  // Every page starts its table with a row that has the same shape (and the same wrapped lines) as the first row of every other page.
  const page = (n, extra = []) => [
    at([28, "Account Statement"]),
    header,
    at([34, "Date"]),
    at([29, "01 Apr 2026"], [86, "UPI/"], [185, "120000000001"], [304, "01 Apr 2026"], [431, "480.00"], [502, "10,495.06"]),
    at([86, "CR/120000000001/"]),
    at([86, "UPI BCCB"]),
    ...extra,
    at([33, String(n)], [52, "03 Nov 2026, 18:54"]),
  ];
  const pages = [page(1), page(2), page(3), page(4, [at([28, "Account Summary:"]), at([29, "Opening Balance"], [185, "10,015.06"])])];
  const out = stripPageFurniture(pages, { bands: bccbHeader });
  assert.equal(out.lines.length, 4 * 3, "the dated row, 'CR/…' and 'UPI BCCB' survive on every page");
  assert.deepEqual(out.lines.slice(0, 3).map((l) => l.text), ["01 Apr 2026 UPI/ 120000000001 01 Apr 2026 480.00 10,495.06", "CR/120000000001/", "UPI BCCB"]);
  assert.equal(out.furniture.length, 4 * 3 + 4, "3 header lines and the page footer on each of 4 pages");
  assert.deepEqual(out.summary.map((l) => l.text), ["Account Summary:", "Opening Balance 10,015.06"]);
  const noBands = stripPageFurniture(pages, {});
  assert.ok(noBands.furniture.every((l) => !/Nov 2026/.test(l.text)) && noBands.lines.some((l) => l.text === "UPI BCCB"), "without header bands only the header block goes; footers and wrapped lines are never guessed at");
});

test("rule 5: an aggregated line shows the count, the first row and the sum of the amounts affected", () => {
  assert.equal(
    describeGroup("debit read from reference number column", [{ row: 7, amount: 1000 }, { row: 3, amount: 250.5 }, { row: 12, amount: 0.8 }]),
    "3 rows: debit read from reference number column (first: row 3; amounts affected 1,251.30)",
  );
  assert.equal(describeGroup("balance chain swapped debit and credit", [{ row: 5, amount: -42 }]), "1 row: balance chain swapped debit and credit (first: row 5; amounts affected 42.00)");
});

test("rule 4: wrapped description lines join with no space after '/', and spacing around '/' never breaks a comparison", () => {
  assert.equal(joinWrappedLines(["UPI/", "CR/120000000001/", "TEST PAYER/", "HDFC/50100000000001/6", "cupcake BCCB"]), "UPI/CR/120000000001/TEST PAYER/HDFC/50100000000001/6 cupcake BCCB");
  assert.equal(joinWrappedLines(["current- MIN BAL", "CHARGS MAB", "Charge"]), "current- MIN BAL CHARGS MAB Charge");
  assert.equal(normalizeDescription("UPI/ CR/131000000002/ TEST PAYER / HDFC/50100000000002/ UPI BCCB"), "UPI/CR/131000000002/TEST PAYER/HDFC/50100000000002/UPI BCCB");
  assert.equal(normalizeDescription("UPI/CR/131000000002/TEST PAYER/HDFC/50100000000002/UPI BCCB"), normalizeDescription("UPI/ CR/131000000002/ TEST PAYER / HDFC/50100000000002/ UPI BCCB"));
});
