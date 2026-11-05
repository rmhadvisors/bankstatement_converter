import assert from "node:assert/strict";
import test from "node:test";

import { parseStatement } from "../src/parsers/parser.js";

// Narration is printed above AND below the dated line (TJSB-style). Across a page break the first dated line of the
// new page owns the lines above it, and the last dated line of the previous page owns the lines below it.
// Made-up statement: invented merchants and amounts.
const line = (pageNumber, y, text) => ({ pageNumber, y, text, items: [{ x: 40, text }] });
const header = (page) => [
  line(page, 700, "Transaction"),
  line(page, 690, "Description Cheque No. Debit Credit Balance"),
  line(page, 680, "Date"),
];

test("narration at a page break goes to the right row", () => {
  const lines = [
    ...header(1),
    line(1, 600, "ALPHA TRADERS PAYMENT"),
    line(1, 590, "01/07/2025 0.00 500.00 10,500.00 CR"),
    line(1, 580, "REF/ALPHA/0001"),
    line(1, 570, "BETA SERVICES"),
    line(1, 560, "02/07/2025 0.00 200.00 10,700.00 CR"),
    line(1, 550, "REF/BETA/0002"),
    line(1, 40, "Page 1 of 2"),
    ...header(2),
    line(2, 600, "GAMMA STORES"),
    line(2, 590, "03/07/2025 100.00 0.00 10,600.00 CR"),
    line(2, 580, "REF/GAMMA/0003"),
  ];
  const text = lines.map((l) => l.text).join("\n");
  const { transactions } = parseStatement({ lines, text, pages: [], pageCount: 2, source: "text" });
  assert.deepEqual(
    transactions.map((t) => t.particulars),
    ["ALPHA TRADERS PAYMENT REF/ALPHA/0001", "BETA SERVICES REF/BETA/0002", "GAMMA STORES REF/GAMMA/0003"],
  );
});
