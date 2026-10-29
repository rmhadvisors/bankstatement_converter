import assert from "node:assert/strict";
import test from "node:test";

import { gstinCheckChar, gstinProblem } from "../../src/invoice/gstin.js";
import { amountToIndianWords, wordsToAmount } from "../../src/invoice/amountWords.js";
import { validateInvoiceJson } from "../../src/invoice/schema.js";
import { validateBatch, validateInvoice } from "../../src/invoice/validate.js";
import { guessEntryType, matchParty } from "../../src/invoice/parties.js";

// Synthetic parties; amounts mirror the 4 real samples (which stay in the ignored fixtures folder).
const gstin = (first14) => first14 + gstinCheckChar(first14);
const SUPPLIER_A = gstin("27AAAPA1111A1Z");
const SUPPLIER_B = gstin("27BBBPB2222B1Z");
const BUYER = gstin("27CCCFC3333C1Z");
const OPTIONS = { financialYear: "2026-27", today: new Date(Date.UTC(2026, 9, 27)) };

const invoice = (fields) => {
  const { ok, errors, invoice: inv } = validateInvoiceJson(fields);
  assert.ok(ok, errors.join("; "));
  return inv;
};
const item = (sno, description, qty, rate, amount, gstRate = 18, extra = {}) => ({ sno, description, qty, rate, amount, gstRate, ...extra });
const messages = (result, level) => result.reasons.filter((r) => !level || r.level === level).map((r) => r.message);

const digitalPdf = () =>
  invoice({
    documentType: "tax_invoice",
    supplier: { name: "Test Powder Coatings", gstin: SUPPLIER_A },
    buyer: { name: "Test Buyer", gstin: BUYER },
    invoiceNo: "TPC/26-27/71",
    invoiceDate: "01/08/2026",
    placeOfSupply: "27-MAHARASHTRA",
    lineItems: [item(1, "Epoxy Resin", 200, 170, 34000, 18, { hsnSac: "39073010" }), item(2, "Resin Solid", 100, 160, 16000, 18, { hsnSac: "39073010", unit: "KGS" })],
    totals: { taxableAmount: 50000, cgstRate: 9, cgst: 4500, sgstRate: 9, sgst: 4500, grandTotal: 59000, amountInWords: "Fifty Nine Thousand Only" },
  });

const handwrittenPaid = () =>
  invoice({
    documentType: "tax_invoice",
    supplier: { name: "TEST DECOR", gstin: SUPPLIER_B },
    buyer: { name: "Test Buyer", gstin: BUYER },
    invoiceNo: "101",
    invoiceDate: "04/08/2026",
    lineItems: [
      item(1, "Film", 15, 60, 900, 18, { hsnSac: "3120" }),
      item(2, "Roller Blinds", 41, 155, 6355, 18, { hsnSac: "6303" }),
      item(3, "Matt", 70, 60, 4200, 18, { hsnSac: "3918" }),
    ],
    totals: { taxableAmount: 11455, cgstRate: 9, cgst: 1030.95, sgstRate: 9, sgst: 1030.95, roundOff: 0.1, grandTotal: 13517, amountInWords: "Thirteen Thousand Five Hundred Seventeen Only" },
    payment: { status: "paid", mode: "cheque", reference: "0095", date: "04/08/2026" },
    confidence: { "lineItems[0].hsnSac": "low" },
  });

const handwrittenPto = () =>
  invoice({
    documentType: "tax_invoice",
    supplier: { name: "TEST CONSTRUCTION CO.", gstin: SUPPLIER_A },
    buyer: { name: "Test School" },
    invoiceNo: "005",
    invoiceDate: "13/08/2026",
    lineItems: [
      item(1, "Wall extra works", 966.45, 160, 154624),
      item(2, "Concrete scoping", 320, 65, 20800),
      item(3, "Concrete road", 172.25, 180, 31005),
      item(4, "Tree cutting, levelling, JCB + 3 labour 2 hours", null, null, 8950),
    ],
    continuedOverleaf: true,
  });

const handwrittenShortPaid = () =>
  invoice({
    documentType: "tax_invoice",
    supplier: { name: "TEST CONSTRUCTION CO.", gstin: SUPPLIER_A },
    buyer: { name: "Test School" },
    invoiceNo: "006",
    invoiceDate: "16/08/2026",
    lineItems: [item(1, "1st floor coba 4in", 337, 105, 35385), item(2, "Classroom coba 3in", 249, 95, 23655)],
    totals: { taxableAmount: 59040, cgstRate: 9, cgst: 5313.6, sgstRate: 9, sgst: 5313.6, grandTotal: 69667.2, amountInWords: "Sixty-nine thousand six hundred sixty-seven, paise twenty" },
    payment: { mode: "NEFT", amount: 69077, date: "20/08/2026" },
    handwrittenNotes: ["Payment received by NEFT Rs 69077 on 20/08/2026"],
  });

test("invoice gstin: format, state code and check character", () => {
  assert.equal(gstinProblem(SUPPLIER_A), null);
  assert.equal(gstinProblem(SUPPLIER_A.toLowerCase().replace(/^(..)/, "$1 ")), null, "spaces/case are tolerated");
  const flipped = SUPPLIER_A.slice(0, 14) + (SUPPLIER_A[14] === "A" ? "B" : "A");
  assert.match(gstinProblem(flipped), /check character should be/);
  // One misread character (O for 0) is caught by the pattern or the checksum.
  assert.notEqual(gstinProblem(SUPPLIER_A.replace("1111", "1O11")), null);
  assert.match(gstinProblem("40AAAPA1111A1ZX"), /not a valid state code/);
  assert.match(gstinProblem("27AAAPA1111A1Z"), /15 characters/);
});

test("invoice amount words: Indian system out, Indian or international wording in", () => {
  assert.equal(amountToIndianWords(13517), "Thirteen Thousand Five Hundred Seventeen Only");
  assert.equal(amountToIndianWords(69667.2), "Sixty Nine Thousand Six Hundred Sixty Seven and Paise Twenty Only");
  assert.equal(amountToIndianWords(154624), "One Lakh Fifty Four Thousand Six Hundred Twenty Four Only");
  assert.equal(amountToIndianWords(123456789.05), "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Paise Five Only");
  assert.equal(amountToIndianWords(0), "Zero Only");

  assert.equal(wordsToAmount("Sixty-nine thousand six hundred sixty-seven, paise twenty"), 69667.2);
  assert.equal(wordsToAmount("Rupees Sixty Nine Thousand Six Hundred and Sixty Seven and Twenty Paise Only"), 69667.2);
  assert.equal(wordsToAmount("One Hundred Fifty Four Thousand Six Hundred Twenty Four"), 154624);
  assert.equal(wordsToAmount("Rs. Twelve Lakhs Only"), 1200000);
  assert.equal(wordsToAmount("One Crore Twenty Lacs"), 12000000);
  assert.equal(wordsToAmount("Thirteen Thousand Five Hundred Seventeen Only"), 13517);
  assert.equal(wordsToAmount("illegible scrawl"), null);
  for (const n of [1, 99, 100, 1001, 99999.99, 100000, 2500000.5, 987654321]) assert.equal(wordsToAmount(amountToIndianWords(n)), n);
});

test("invoice schema: missing keys become null, wrong types are errors for a retry", () => {
  const { ok, invoice: inv } = validateInvoiceJson({ invoiceNo: "1" });
  assert.ok(ok);
  assert.equal(inv.supplier.gstin, null);
  assert.deepEqual(inv.lineItems, []);
  assert.equal(inv.totals.grandTotal, null);

  const bad = validateInvoiceJson({ totals: { grandTotal: "1,54,624" }, documentType: "bill", lineItems: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors.join("\n"), /totals\.grandTotal: expected number/);
  assert.equal(validateInvoiceJson("not json").ok, false);
});

test("invoice validation: digital PDF sample is OK, intra-state CGST/SGST check out", () => {
  const result = validateInvoice(digitalPdf(), OPTIONS);
  assert.equal(result.status, "OK", messages(result).join("; "));
  assert.equal(result.computed.intraState, true);
  assert.deepEqual(result.computed.expectedTax, { cgst: 4500, sgst: 4500, igst: 0 });
  assert.deepEqual(result.computed.rateGroups, [{ rate: 18, taxable: 50000, cgst: 4500, sgst: 4500, igst: 0 }]);
});

test("invoice validation: handwritten paid sample is OK with round-off, words, and a verify-HSN note", () => {
  const result = validateInvoice(handwrittenPaid(), OPTIONS);
  assert.equal(result.status, "OK", messages(result).join("; "));
  assert.deepEqual(messages(result, "note"), ['Verify line 1 HSN/SAC: read as "3120" (low confidence)']);
  assert.equal(result.computed.roundOff, 0.1);
  assert.equal(result.computed.amountInWords, "Thirteen Thousand Five Hundred Seventeen Only");
});

test("invoice validation: P.T.O. with blank totals is INCOMPLETE and the line mismatch is shown, not fixed", () => {
  const inv = handwrittenPto();
  const result = validateInvoice(inv, OPTIONS);
  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(messages(result, "incomplete"), [
    "Continued overleaf (P.T.O.) -- next page not included",
    "Totals section blank; sum of lines 2,15,379 (computed only)",
  ]);
  assert.deepEqual(messages(result, "review"), ["Line 1 (Wall extra works): 1,54,624 written vs 1,54,632 computed (qty x rate)"]);
  assert.deepEqual(result.computed.lines.map((l) => l.ok), [false, true, true, null], "lump-sum line is not checked");
  assert.equal(inv.lineItems[0].amount, 154624, "written amount untouched");
});

test("invoice validation: short payment is a note with the difference, status stays OK", () => {
  const result = validateInvoice(handwrittenShortPaid(), OPTIONS);
  assert.equal(result.status, "OK", messages(result).join("; "));
  assert.deepEqual(messages(result, "note"), ["Payment received 69,077, 590.20 less than grand total"]);
  assert.deepEqual(result.computed.payment, { status: "partial", shortBy: 590.2 });
});

test("invoice validation: arithmetic, tax type, words, GSTIN and date problems need review", () => {
  const base = digitalPdf();
  const check = (mutate, pattern) => {
    const inv = structuredClone(base);
    mutate(inv);
    const result = validateInvoice(inv, OPTIONS);
    assert.equal(result.status, "NEEDS REVIEW", `expected review for ${pattern}`);
    assert.match(messages(result, "review").join("\n"), pattern);
  };
  check((i) => (i.totals.taxableAmount = 51000), /Sum of lines 50,000 vs taxable amount 51,000/);
  check((i) => (i.totals.cgst = 4600), /CGST: 4,600 written vs 4,500 computed/);
  check((i) => Object.assign(i.totals, { cgst: 0, sgst: 0, igst: 9000 }), /IGST charged, but supplier and place of supply are both state 27/);
  check((i) => (i.placeOfSupply = "29-KARNATAKA"), /CGST\/SGST charged, but supplier state 27 differs from place of supply 29/);
  check((i) => (i.totals.grandTotal = 59500), /Grand total 59,500 vs taxable \+ taxes 59,000/);
  check((i) => (i.totals.amountInWords = "Fifty Eight Thousand Only"), /Amount in words says 58,000/);
  check((i) => (i.supplier.gstin = SUPPLIER_A.slice(0, 14) + "0"), /Supplier GSTIN .*possible misread/);
  check((i) => (i.invoiceDate = "01/11/2026"), /in the future/);
  check((i) => (i.invoiceDate = "15/03/2026"), /outside FY 2026-27/);
  check((i) => (i.invoiceDate = "31/02/2026"), /not a valid dd\/mm\/yyyy/);
  check((i) => (i.totals.roundOff = 1.5), /Round-off 1.50 is more than/);

  const interState = structuredClone(base);
  interState.placeOfSupply = "29-KARNATAKA";
  Object.assign(interState.totals, { cgstRate: null, cgst: null, sgstRate: null, sgst: null, igstRate: 18, igst: 9000 });
  assert.equal(validateInvoice(interState, OPTIONS).status, "OK");
});

test("invoice validation: multi-rate invoice expects tax per rate", () => {
  const inv = digitalPdf();
  inv.lineItems[1].gstRate = 12;
  Object.assign(inv.totals, { cgstRate: null, sgstRate: null, cgst: 4020, sgst: 4020, grandTotal: 58040, amountInWords: null });
  const result = validateInvoice(inv, OPTIONS);
  assert.equal(result.status, "OK", messages(result).join("; "));
  assert.deepEqual(result.computed.rateGroups.map((g) => [g.rate, g.taxable, g.cgst]), [[18, 34000, 3060], [12, 16000, 960]]);
});

test("invoice batch: duplicates within the batch and against history", () => {
  const results = validateBatch(
    [{ invoice: digitalPdf(), sourceFile: "a.pdf" }, { invoice: { ...digitalPdf(), invoiceNo: " tpc/26-27/71 " }, sourceFile: "b.pdf" }, { invoice: handwrittenShortPaid() }],
    { ...OPTIONS, history: [{ supplierGstin: SUPPLIER_A, invoiceNo: "6", invoiceDate: "16/08/2026" }] },
  );
  assert.deepEqual(results.map((r) => r.status), ["OK", "NEEDS REVIEW", "NEEDS REVIEW"]);
  assert.match(messages(results[1]).join(), /Duplicate: same supplier and invoice no\. as a\.pdf in this batch/);
  assert.match(messages(results[2]).join(), /Duplicate: .* history \(16\/08\/2026\)/);
});

test("invoice parties: GSTIN first, then fuzzy name; unknown parties get a guess", () => {
  const parties = [
    { name: "SAMPLE POWDER COATING", gstin: null, entryType: "STOCK" },
    { name: "SAMPLE BUILDERS CO.", gstin: null, entryType: "NORMAL" },
    { name: "SAMPLE DECOR", gstin: null, entryType: "STOCK" },
    { name: "TEST TRADERS", gstin: SUPPLIER_B, entryType: "NORMAL" },
  ];
  assert.equal(matchParty({ name: "Something else", gstin: SUPPLIER_B }, parties).matchedBy, "gstin");
  const typo = matchParty({ name: "Sample Powder paint" }, [{ name: "SAMPLE POWER PAINT", entryType: "STOCK" }]);
  assert.equal(typo.party.entryType, "STOCK");
  assert.equal(typo.matchedBy, "name");
  assert.equal(matchParty({ name: "M/s. Sample Builders Company" }, parties).party.name, "SAMPLE BUILDERS CO.");
  assert.equal(matchParty({ name: "Sample Traders" }, parties), null);

  assert.equal(guessEntryType({ supplier: { name: "Sea View Restaurant & Bar" }, lineItems: [{ description: "Beer" }] }).entryType, "TCS");
  assert.equal(guessEntryType(handwrittenPto()).entryType, "NORMAL");
  assert.equal(guessEntryType(digitalPdf()).entryType, "STOCK");
});
