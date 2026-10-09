import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { buildLinesFromParsedResult } from "../src/parsers/ocrExtractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Image-only ICICI quarterly statement (boxed, shaded table). OCR.space returns each date as three
// words "01 - 10 - 2024", which no parser's date regex matched -> "No transaction rows".
test("OCR line builder rejoins dates OCR.space splits into separate words", () => {
  const words = ["01", "-", "10", "-", "2024", "B/F", "6,785.49"].map((WordText, i) => ({ WordText, Left: i * 50, Top: 10, Width: 40, Height: 10 }));
  const [line] = buildLinesFromParsedResult({ TextOverlay: { Lines: [{ Words: words }] } }, 1);
  assert.match(line.text, /^01-10-2024 /);
});

test("ICICI 0836 scanned statement extracts every row and reconciles", async () => {
  const statement = await convertPdfToStatement(join(__dirname, "fixtures", "icici-0836-scanned.pdf"));
  const r = statement.reconciliation;
  assert.equal(r.status, "PASS");
  assert.equal(r.openingBalance, 6785.49);
  assert.equal(r.statementClosingBalance, 8621.99);
  assert.equal(r.totalCredits, 1836.5);
  assert.deepEqual(statement.transactions.slice(1).map((t) => t.deposit), [1764.5, 4, 4, 64]);
});
