import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { convertPdfToStatement } from "../src/parsers/converter.js";

// Real client statements live in the git-ignored fixtures/bank/ folder; each test skips without its file.
// Expected figures are the statement's own printed totals.
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(__dirname, "fixtures", "bank", name);
const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + (row[key] || 0), 0) * 100) / 100;

const CASES = [
  {
    file: "axis_ambika_aug-oct26.pdf",
    format: "axis-report",
    rows: 627,
    debits: 6551660.13,
    credits: 7811508.0,
    closing: 1266824.79,
  },
  {
    file: "axis_shivshakti_aug-oct26.pdf",
    format: "axis-report",
    rows: 27,
    debits: 1388181.0,
    credits: 1401925.0,
    closing: 16401.3,
  },
  {
    file: "idfc_mrunmayee_sep26.pdf",
    format: "idfc-first",
    rows: 11,
    debits: 3362500.0,
    credits: 0,
    closing: 625232.4,
    check: (rows) => {
      assert.deepEqual(rows.map((row) => row.chequeNo), ["000143", "000147", "000148", "000149", "000301", "000302", "000303", "000304", "000305", "000307", "000306"]);
      assert.equal(rows[0].particulars, "CHQ Paid/000143/MSMRCONTRUCTIONPROPUDAYSH/RATNAKAR");
      assert.deepEqual([rows[0].withdrawal, rows[0].deposit], [99000, null]);
      assert.equal(rows[3].particulars, "TRANSFER TO DEPOSIT: CHEQUE NO. 000149/");
      assert.equal(rows[4].particulars, "IFT/MRUNMAYEE DEVELOPERS MAIT/MRUNMAYEE DEVELOPERS NEFT/IDFBH26265747502/GLOBAL GYPSUM PVT LT/UTIB000");
      assert.ok(rows.every((row) => !/Opening Balance|Total Debit|REGISTERED OFFICE|STATEMENT OF ACCOUNT/i.test(row.particulars)));
    },
  },
  {
    file: "bccb_odcc_orbit_sep26.pdf",
    format: "bccb-ledger",
    rows: 55,
    debits: 3295859.1,
    credits: 2050000.0,
    closing: -5206114.46,
    check: (rows) => {
      assert.equal(rows.filter((row) => row.withdrawal).length, 52);
      assert.ok(!rows.some((row) => /^B\/F/.test(row.particulars)));
    },
  },
  {
    file: "idbi_rep31_kuber_aug26_scanned.pdf",
    format: "idbi-rep31-ocr",
    needsTesseract: true,
    rows: 3,
    debits: 254000.0,
    credits: 200000.0,
    closing: 113482.84,
    check: (rows) => {
      assert.deepEqual(
        rows.map((row) => [row.date.toISOString().slice(0, 10), row.withdrawal, row.deposit, row.balance, row.chequeNo]),
        [
          ["2026-08-27", null, 200000, 367482.84, null],
          ["2026-08-27", 200000, null, 167482.84, "29668"],
          ["2026-08-27", 54000, null, 113482.84, "029669"],
        ],
      );
      assert.match(rows[1].particulars, /^SELF$/);
      assert.match(rows[2].particulars, /RMH ADVISO$/);
    },
  },
];

const hasTesseract = (() => {
  try {
    execFileSync(process.env.TESSERACT_PATH || (process.platform === "win32" ? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe" : "tesseract"), ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

for (const expected of CASES) {
  const path = fixture(expected.file);
  const skip = !existsSync(path) ? `needs fixtures/bank/${expected.file}` : expected.needsTesseract && !hasTesseract ? "needs the tesseract binary" : false;
  test(`client statement ${expected.file}: every row, printed totals and closing balance`, { skip }, async () => {
    const statement = await convertPdfToStatement(path);
    const rows = statement.transactions;

    assert.ok(statement.logs.some((log) => log.message === `Detected statement format: ${expected.format}.`));
    assert.equal(rows.length, expected.rows);
    assert.equal(sum(rows, "withdrawal"), expected.debits);
    assert.equal(sum(rows, "deposit"), expected.credits);
    assert.equal(rows.at(-1).balance, expected.closing);
    assert.equal(statement.reconciliation.status, "PASS");
    assert.ok(rows.every((row) => row.date instanceof Date && !/KANDIVALI|\[MH\]|\(\d{3,4}\)$/.test(row.particulars)));
    expected.check?.(rows);
  });
}
