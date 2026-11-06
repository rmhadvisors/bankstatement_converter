import assert from "node:assert/strict";
import test from "node:test";

import { isFederalLayout, parseFederalTransactions } from "../src/parsers/parsers/federalParser.js";

// Federal Bank text-layer statement whose dates read "01-OCT-2026": one line per row (both dates, start of the
// narration, type, Tran ID, ONE amount, balance + Cr), the rest of the narration wraps BELOW it, the Tran ID can
// have two letters (FB123), and the GRAND TOTAL prints one decimal ("1100.5"). Made-up names and amounts.
const lines = [
  "The Federal Bank Ltd.",
  "Statement of Account for the period 2026-10-01 to 2026-10-31",
  "Tran Cheque DR",
  "Date Value Date Particulars Tran ID Withdrawals Deposits Balance",
  "Type Details /CR",
  "Opening Balance 10000.00 Cr",
  "01-OCT-2026 01-OCT-2026 RTG/SAMPLE TRADERS FT S1001 1000.50 9000.50 Cr",
  "/FDRLR5202610010001",
  "BANK",
  "02-OCT-2026 02-OCT-2026 TFR:DEMO ENTERPRISES TFR FB123 500.00 9500.50 Cr",
  "Page 1 of 2",
  "03-OCT-2026 03-OCT-2026 Charges for RTGS Customer Payment : TFR S1002 100.00 9400.50 Cr",
  "GRAND TOTAL 1100.5 500.0",
  "Abbreviations Used:",
  "FT : Fund Transfer CLG : Clearing Transaction",
].map((text) => ({ text, pageNumber: 1 }));

test("Federal DD-MON-YYYY layout: one-line rows, narration below, two-letter Tran ID, one-decimal grand total", () => {
  assert.ok(isFederalLayout(lines));
  const { transactions, printedTotals } = parseFederalTransactions(lines);
  assert.deepEqual(
    transactions.map((t) => [t.date.toISOString().slice(0, 10), t.particulars, t.withdrawal, t.deposit, t.balance, t.chequeNo]),
    [
      ["2026-10-01", "RTG/SAMPLE TRADERS /FDRLR5202610010001 BANK", 1000.5, null, 9000.5, "S1001"],
      ["2026-10-02", "TFR:DEMO ENTERPRISES", null, 500, 9500.5, "FB123"],
      ["2026-10-03", "Charges for RTGS Customer Payment :", 100, null, 9400.5, "S1002"],
    ],
  );
  assert.deepEqual([printedTotals.withdrawal, printedTotals.deposit], [1100.5, 500]);
});
