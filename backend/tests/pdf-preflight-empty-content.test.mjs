import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "fixtures", "idbi-85-page-mostly-empty.pdf");

// Real 85-page, 82.7MB PDF where 84 of the 85 pages have zero extractable text and zero embedded
// images/resources -- genuinely nothing to parse -- while the file itself carries a large amount
// of orphaned internal PDF objects unrelated to any page's content. Before the pre-check in
// pdfPreflight.js existed, this file fell straight through into the OCR fallback pipeline (a
// multi-page PDF with sparse/no text triggers OCR), which then spent minutes retrying OCR calls
// and running local Tesseract OCR across dozens of blank pages. This is the permanent regression
// fixture for the fail-fast path: it must fail fast with a clear diagnostic instead.
test("an effectively-empty multi-page PDF fails fast with a clear diagnostic instead of hanging", async () => {
  const start = Date.now();
  await assert.rejects(
    () => convertPdfToStatement(pdfPath),
    (error) => {
      assert.equal(error.code, "PDF_NO_READABLE_CONTENT");
      assert.match(error.message, /no readable content/i);
      assert.match(error.message, /85/); // total page count is surfaced
      assert.match(error.message, /corrupted or exported incorrectly/i);
      return true;
    },
  );

  const elapsedMs = Date.now() - start;
  assert.ok(elapsedMs < 10000, `expected the fail-fast path to finish in well under 10s, took ${elapsedMs}ms`);
});
