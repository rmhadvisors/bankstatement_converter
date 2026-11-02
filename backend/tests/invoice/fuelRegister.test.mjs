import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

import { buildFuelRegister, loadReading } from "../../src/invoice/fuelRegister.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "invoices", "jigeesha");
const narrationDate = new Date(2026, 7, 7); // 07-08-2026

// ---- logic on a tiny made-up register (always runs) ----
const day = (d, meter, pump, net, cumulative, unreadable = []) => ({ day: d, salesByMeter: meter, pumpTest: pump, netSales: net, cumulative, unreadable });
const page = (n, product, rows) => ({ page: n, kind: "register", product, month: 4, description: "", rows, rates: [] });
const rates = (n, list) => ({ page: n, kind: "rates", product: null, month: null, description: "", rows: [], rates: list.map(([product, rate]) => ({ product, label: product, rate })) });

test("fuel register: rows in day/product order, SR from April, amount rounded, dash days skipped, other pages reported", () => {
  const r = buildFuelRegister(
    {
      pages: [
        page(1, "MS", [day(1, 110, 10, 100, 100), day(2, null, null, null, 100), day(3, 55, 5, 50, 150)]),
        page(2, "HSD", [day(1, 33, 3, 30, 30), day(2, null, null, null, 30), day(3, 12, 2, 10, 40)]),
        { page: 3, kind: "other", product: null, month: null, description: "lubricant list", rows: [], rates: [] },
        rates(4, [["MS", 111.61], ["HSD", 98.24]]),
      ],
    },
    { narrationDate },
  );
  assert.deepEqual(r.rows.map((x) => `${x.date} ${x.sr} ${x.item} ${x.qty}`), [
    "2026-04-01 A1 High Speed Diesel-1 30",
    "2026-04-01 A2 Petrol 100",
    "2026-04-03 A3 High Speed Diesel-1 10",
    "2026-04-03 A4 Petrol 50",
  ]);
  assert.equal(r.rows[1].amt, 11161);
  assert.equal(r.rows[0].amt, 2947.2);
  assert.equal(r.rows[0].narration, "BEING SALES RECORDED ON 07-08-2026");
  assert.deepEqual(r.ignoredPages, [{ page: 3, description: "lubricant list" }]);
  // the other three products of the party have no page: reported, never silent
  assert.equal(r.status, "NEEDS REVIEW");
  assert.equal(r.flags.filter((f) => /No (HSD|MSP|HSDT) register page/.test(f.reason)).length, 3);
  assert.equal(r.period.sheetName, "APR 26");
});

test("fuel register: every failed check is a plain sentence on the rows it names; numbers are never changed", () => {
  const r = buildFuelRegister(
    {
      pages: [
        page(1, "MS", [day(1, 110, 10, 100, 100), day(2, 60, 10, 55, 155), day(3, 50, 0, 50, 205), day(4, null, null, null, 260), day(5, null, 5, 7, null, ["cumulative"])]),
        rates(2, [["MS", 100]]),
      ],
    },
    { narrationDate },
  );
  const reasons = r.flags.map((f) => f.reason);
  assert.ok(reasons.includes("Petrol, day 2: sales by meter 60 minus pump test 10 is 50, but net sales reads 55."));
  // running total is 100, 155, 205: the printed 155 / 205 agree, 260 on day 4 has no net sales
  assert.ok(reasons.includes("Petrol, day 4: the cumulative sales changed to 260 but net sales is blank."));
  assert.ok(reasons.includes("Petrol, day 5: could not read cumulative."));
  assert.equal(r.rows.find((x) => x.date === "2026-04-02").qty, 55); // read value kept
  assert.deepEqual(r.rows.find((x) => x.date === "2026-04-02").review, ["Petrol, day 2: sales by meter 60 minus pump test 10 is 50, but net sales reads 55."]);
  assert.equal(r.rows.find((x) => x.date === "2026-04-03").review.length, 0);

  const broken = buildFuelRegister({ pages: [page(1, "MS", [day(1, 110, 10, 100, 100), day(2, 60, 10, 50, 140), day(3, 60, 10, 50, 190)]), rates(2, [["MS", 100]])] }, { narrationDate });
  const first = broken.flags.filter((f) => /cumulative/.test(f.reason));
  assert.equal(first.length, 1); // only the first break
  assert.equal(first[0].reason, "Petrol: from day 2 the printed cumulative sales (140) is 10 lower than the running total of net sales (150).");

  const noRate = buildFuelRegister({ pages: [page(1, "MS", [day(1, 110, 10, 100, 100)])] }, { narrationDate });
  assert.equal(noRate.rows[0].rate, null);
  assert.equal(noRate.rows[0].amt, null);
  assert.ok(noRate.flags.some((f) => f.reason === "No rates page was found, so no row has a rate or amount."));
});

// ---- the real July 2026 register: saved readings (no live calls) vs the golden workbook ----
const raw = join(dir, "july26.reading.json");
const reviewed = join(dir, "july26.reading.reviewed.json");
const golden = join(dir, "july26_reference.xlsx");
const skip = [raw, reviewed, golden].every(existsSync) ? false : "needs fixtures/invoices/jigeesha/ (git-ignored client files)";

async function goldenRows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(golden);
  const out = [];
  wb.getWorksheet("JULY 26").eachRow((row, n) => {
    const v = (c) => row.getCell(c).value?.result ?? row.getCell(c).value;
    if (n > 1 && v(1)) out.push({ date: v(1).toISOString().slice(0, 10), sr: v(2), item: v(4), qty: v(5), rate: v(6), amt: v(7) });
  });
  return out;
}

test("fuel register July 26: the reviewed reading equals the golden workbook; only the register's own error is flagged", { skip }, async () => {
  const r = buildFuelRegister(await loadReading(reviewed), { narrationDate });
  const g = await goldenRows();
  assert.equal(r.period.sheetName, "JULY 26");
  assert.equal(r.rows.length, 97);
  assert.deepEqual(r.rows.map((x) => [x.date, x.sr, x.item, x.qty, x.rate]), g.map((x) => [x.date, x.sr, x.item, x.qty, x.rate]));
  assert.deepEqual(r.rows.map((x) => Math.round(x.amt * 100)), g.map((x) => Math.round(x.amt * 100)));
  const by = (item, f) => r.rows.filter((x) => x.item === item).reduce((s, x) => s + f(x), 0);
  const counts = { "High Speed Diesel-1": [28, 75213], "High Speed Diesel-2": [21, 95254], Petrol: [18, 13043], "Power Petrol": [23, 11508], "HIGH SPEED DIESEL (TURBO)": [7, 20577] };
  for (const [item, [n, qty]] of Object.entries(counts)) assert.deepEqual([by(item, () => 1), by(item, (x) => x.qty)], [n, qty], item);
  assert.equal(Math.round(r.rows.reduce((s, x) => s + x.amt, 0) * 100), 2169256408);
  assert.deepEqual(r.flags.map((f) => f.reason), ["Power Petrol: from day 29 the printed cumulative sales (9,239) is 720 lower than the running total of net sales (9,959)."]);
  assert.deepEqual(r.ignoredPages.map((p) => p.page), [6]);
  assert.equal(r.status, "NEEDS REVIEW");
});

test("fuel register July 26: a misread handwritten digit in the raw reading is reported, not hidden", { skip }, async () => {
  const r = buildFuelRegister(await loadReading(raw), { narrationDate });
  assert.equal(r.rows.length, 97);
  assert.equal(r.rows.find((x) => x.date === "2026-07-28" && x.item === "High Speed Diesel-1").qty, 4832); // as read
  assert.ok(r.flags.some((f) => f.reason === "High Speed Diesel-1: from day 28 the printed cumulative sales (62,251) is 20 higher than the running total of net sales (62,231)."));
});
