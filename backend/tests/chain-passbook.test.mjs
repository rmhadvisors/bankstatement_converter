import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";
import { fixtureGate } from "./helpers/fixtureGate.mjs";

// Two phone-photographed passbooks whose OCR is too damaged for exact recovery (curved pages, faded or rotated
// pages). Client files, git-ignored, OCR answers cached next to them. What must hold: the pages OCR could read come
// out right (balances checked by hand against the photos), and the file is NEVER "ok" while pages are missing.
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bank");
const cases = [
  {
    file: "bassein-savings-passbook-4pages.pdf",
    firstBalances: [194906.03, 194904.23, 196043.23, 215176.23, 234309.23, 253442.23, 3442.23, 3432.23, 3430.43, 5008.43, 24141.43, 45400.43],
  },
  {
    file: "sbi-passbook-14pages.pdf",
    firstBalances: [6887776.59, 6877776.59, 6897776.59, 6977776.59, 7013776.59, 7021776.59, 7027026.59, 7035026.59, 6930314.59, 6966314.59, 6883554.59, 6868554.59],
  },
];

for (const { file, firstBalances } of cases) {
  const gate = fixtureGate(`bank/${file}`, join(dir, file));
  test(`photographed passbook ${file}: readable pages exact, never ok`, { skip: gate.skip, timeout: 60_000 }, async () => {
    gate.assertPresent();
    const statement = await convertPdfToStatement(join(dir, file), { scanned: true });
    const rows = statement.transactions;
    assert.equal(statement.detectedFormat, "chain-passbook");
    assert.deepEqual(rows.slice(0, firstBalances.length).map((row) => row.balance), firstBalances);
    // The rows before the first unreadable page continue from one another (a dropped page is a gap, not a row).
    for (let index = 1; index < firstBalances.length; index += 1) {
      const moved = Math.round((rows[index].balance - rows[index - 1].balance) * 100) / 100;
      assert.equal(moved, Math.round(((rows[index].deposit ?? 0) - (rows[index].withdrawal ?? 0)) * 100) / 100, `row ${index + 1}`);
    }
    assert.equal(statement.review.status, "needs_review");
  });
}
