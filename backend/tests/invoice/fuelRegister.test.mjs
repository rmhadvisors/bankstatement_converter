import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

import { buildFuelRegister, financialYearToYear, loadReading } from "../../src/invoice/fuelRegister.js";
import { handleFuelBuild, handleFuelExport } from "../../src/invoice/fuelService.js";
import { buildFuelWorkbookBuffer } from "../../src/invoice/fuelWorkbook.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "invoices", "jigeesha");
const narrationDate = "2026-08-07";
const financialYear = "2026-27";
const opts = { narrationDate, financialYear };

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
    opts,
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
    opts,
  );
  const reasons = r.flags.map((f) => f.reason);
  assert.ok(reasons.includes("Petrol, day 2: sales by meter 60 minus pump test 10 is 50, but net sales reads 55."));
  // running total is 100, 155, 205: the printed 155 / 205 agree, 260 on day 4 has no net sales
  assert.ok(reasons.includes("Petrol, day 4: the cumulative sales changed to 260 but net sales is blank."));
  assert.ok(reasons.includes("Petrol, day 5: could not read cumulative."));
  assert.equal(r.rows.find((x) => x.date === "2026-04-02").qty, 55); // read value kept
  assert.deepEqual(r.rows.find((x) => x.date === "2026-04-02").review, ["Petrol, day 2: sales by meter 60 minus pump test 10 is 50, but net sales reads 55."]);
  assert.equal(r.rows.find((x) => x.date === "2026-04-03").review.length, 0);

  const broken = buildFuelRegister({ pages: [page(1, "MS", [day(1, 110, 10, 100, 100), day(2, 60, 10, 50, 140), day(3, 60, 10, 50, 190)]), rates(2, [["MS", 100]])] }, opts);
  const first = broken.flags.filter((f) => /cumulative/.test(f.reason));
  assert.equal(first.length, 1); // only the first break
  assert.equal(first[0].reason, "Petrol: from day 2 the printed cumulative sales (140) is 10 lower than the running total of net sales (150).");

  const noRate = buildFuelRegister({ pages: [page(1, "MS", [day(1, 110, 10, 100, 100)])] }, opts);
  assert.equal(noRate.rows[0].rate, null);
  assert.equal(noRate.rows[0].amt, null);
  assert.ok(noRate.flags.some((f) => f.reason === "No rates page was found, so no row has a rate or amount."));
});

test("fuel register: the year comes from the financial year (Apr-Dec = start year, Jan-Mar = start year + 1), all 12 months", () => {
  const expected = { 4: 2026, 5: 2026, 6: 2026, 7: 2026, 8: 2026, 9: 2026, 10: 2026, 11: 2026, 12: 2026, 1: 2027, 2: 2027, 3: 2027 };
  for (const [month, year] of Object.entries(expected)) assert.equal(financialYearToYear("2026-27", Number(month)), year, `month ${month}`);
  assert.equal(financialYearToYear("2099-00", 12), 2099);
  assert.throws(() => financialYearToYear("2026-28", 7), /not a financial year/);
  // a register page for March ends up in the following calendar year, with sheet name and SR letter L
  const march = buildFuelRegister({ pages: [{ ...page(1, "MS", [day(1, 110, 10, 100, 100)]), month: 3 }, rates(2, [["MS", 100]])] }, opts);
  assert.deepEqual([march.period.label, march.period.sheetName, march.rows[0].date, march.rows[0].sr], ["March 2027", "MAR 27", "2027-03-01", "L1"]);
});

test("fuel register: two readings that differ flag exactly the differing cells; an edit or an accept clears the flag", () => {
  const first = page(1, "MS", [day(1, 110, 10, 100, 100), day(2, 60, 10, 50, 150)]);
  first.rows[1].alt = { netSales: 55 }; // the second reading says 55 for day 2
  const reading = { pages: [first, rates(2, [["MS", 100]])] };
  const r = buildFuelRegister(reading, opts);
  const flagged = r.flags.filter((f) => f.kind === "disagree");
  assert.deepEqual(flagged.map((f) => f.reason), ["Petrol, day 2: net sales reads 50 on the first reading and 55 on the second."]);
  assert.deepEqual(flagged[0].values, { first: 50, second: 55 });
  // only that cell is not clean
  const petrol = r.tables.find((t) => t.item === "Petrol");
  assert.deepEqual(Object.keys(petrol.rows[1].cells), ["netSales"]);
  assert.deepEqual(Object.keys(petrol.rows[0].cells), []);
  assert.equal(r.rows.find((x) => x.date === "2026-04-02").qty, 50); // first reading kept
  // the reviewer edits the cell: disagreement gone
  const edited = structuredClone(reading);
  Object.assign(edited.pages[0].rows[1], { netSales: 55, edited: ["netSales"] });
  assert.equal(buildFuelRegister(edited, opts).flags.filter((f) => f.kind === "disagree").length, 0);
  // or accepts it as read: still listed, no longer unresolved
  const acc = buildFuelRegister(reading, { ...opts, accepted: [{ id: flagged[0].id, note: "page shows 50" }] });
  assert.equal(acc.flags.find((f) => f.id === flagged[0].id).accepted, "page shows 50");
  assert.equal(acc.unresolved, r.unresolved - 1);
  // a rates disagreement is flagged too; an edited rate overrides it
  const rateReading = { pages: [first, rates(2, [["MS", 100]])] };
  rateReading.pages[1].rates[0].alt = 101;
  assert.ok(buildFuelRegister(rateReading, opts).flags.some((f) => f.kind === "rate-disagree"));
  assert.ok(!buildFuelRegister(rateReading, { ...opts, ratesOverride: { MS: 100 } }).flags.some((f) => f.kind === "rate-disagree"));
});

// ---- the real July 2026 register: saved readings (no live calls) vs the golden workbook ----
const raw = join(dir, "july26.reading.json"); // first reading + second reading of every register/rates page
const reviewed = join(dir, "july26.reviewed.json"); // what a reviewer sends back: edits + accepted flags
const golden = join(dir, "july26_reference.xlsx");
const skip = [raw, reviewed, golden].every(existsSync) ? false : "needs fixtures/invoices/jigeesha/ (git-ignored client files)";

const cellValue = (c) => c.value?.result ?? c.value;
async function goldenRows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(golden);
  const out = [];
  wb.getWorksheet("JULY 26").eachRow((row, n) => {
    if (n > 1 && cellValue(row.getCell(1))) out.push({ date: cellValue(row.getCell(1)).toISOString().slice(0, 10), sr: cellValue(row.getCell(2)), item: cellValue(row.getCell(4)), qty: cellValue(row.getCell(5)), rate: cellValue(row.getCell(6)), amt: cellValue(row.getCell(7)) });
  });
  return out;
}
const reviewedBuild = async (extra = {}) => {
  const { pages, accepted } = JSON.parse(await readFile(reviewed, "utf8"));
  return buildFuelRegister({ pages }, { ...opts, accepted, ...extra });
};

test("fuel register July 26: the reviewed reading equals the golden workbook", { skip }, async () => {
  const r = await reviewedBuild();
  const g = await goldenRows();
  assert.equal(r.period.sheetName, "JULY 26");
  assert.equal(r.period.label, "July 2026");
  assert.equal(r.rows.length, 97);
  assert.deepEqual(r.rows.map((x) => [x.date, x.sr, x.item, x.qty, x.rate]), g.map((x) => [x.date, x.sr, x.item, x.qty, x.rate]));
  assert.deepEqual(r.rows.map((x) => Math.round(x.amt * 100)), g.map((x) => Math.round(x.amt * 100)));
  const by = (item, f) => r.rows.filter((x) => x.item === item).reduce((s, x) => s + f(x), 0);
  const counts = { "High Speed Diesel-1": [28, 75213], "High Speed Diesel-2": [21, 95254], Petrol: [18, 13043], "Power Petrol": [23, 11508], "HIGH SPEED DIESEL (TURBO)": [7, 20577] };
  for (const [item, [n, qty]] of Object.entries(counts)) assert.deepEqual([by(item, () => 1), by(item, (x) => x.qty)], [n, qty], item);
  assert.equal(Math.round(r.rows.reduce((s, x) => s + x.amt, 0) * 100), 2169256408);
  assert.deepEqual(r.ignoredPages.map((p) => p.page), [6]);
  assert.equal(r.unresolved, 0);
});

test("fuel register July 26: raw double reading flags disagreements, suggests 4852 for HSD-1 day 28 and nothing for the Power Petrol 720", { skip }, async () => {
  const r = buildFuelRegister(await loadReading(raw), opts);
  assert.equal(r.rows.length, 97);
  assert.equal(r.rows.find((x) => x.date === "2026-07-28" && x.item === "High Speed Diesel-1").qty, 4832); // as read, never changed
  const chain = (item) => r.flags.find((f) => f.kind === "chain" && f.product === item);
  assert.equal(chain("High Speed Diesel-1").reason, "High Speed Diesel-1: from day 28 the printed cumulative sales (62,251) is 20 higher than the running total of net sales (62,231).");
  assert.equal(chain("High Speed Diesel-1").suggestion.value, 4852);
  assert.equal(r.flags.find((f) => f.id === "disagree|High Speed Diesel-1|28|netSales|").values.second, 4852);
  const power = chain("Power Petrol");
  assert.match(power.reason, /720 lower than the running total of net sales \(9,959\)\. Register total looks wrong, rows kept as read\.$/);
  assert.equal(power.suggestion, null);
  assert.equal(power.registerError, true);
  assert.equal(r.status, "NEEDS REVIEW");
  // the same register without the second reading: only the checks remain, same two chain flags
  const single = buildFuelRegister({ pages: (await loadReading(raw)).pages }, opts);
  assert.deepEqual(single.flags.map((f) => f.kind), ["chain", "chain"]);
});

// ---- export ----
test("fuel register export: golden format, clean export has no Review sheet, an unresolved export adds it last", { skip }, async () => {
  const clean = await reviewedBuild();
  const buffer = await buildFuelWorkbookBuffer({ sheetName: clean.period.sheetName, rows: clean.rows, review: null });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["JULY 26"]);
  const gold = new ExcelJS.Workbook();
  await gold.xlsx.readFile(golden);
  const [a, b] = [wb.getWorksheet("JULY 26"), gold.getWorksheet("JULY 26")];
  assert.equal(a.columnCount, 10); // no Error column
  const comparable = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? Math.round(v * 100) : v);
  for (let r = 1; r <= 98; r++) {
    for (let c = 1; c <= 10; c++) {
      const [x, y] = [a.getCell(r, c), b.getCell(r, c)];
      const at = x.address;
      assert.equal(comparable(cellValue(x)), comparable(cellValue(y)), at);
      assert.equal(x.numFmt, y.numFmt, `${at} number format`);
      assert.deepEqual([x.font?.name, x.font?.size, !!x.font?.bold], [y.font?.name, y.font?.size, !!y.font?.bold], `${at} font`);
      assert.equal(x.fill?.fgColor?.argb, y.fill?.fgColor?.argb, `${at} fill`);
      assert.equal(x.border?.top?.style, y.border?.top?.style, `${at} border`);
    }
  }
  for (let c = 1; c <= 10; c++) assert.equal(a.getColumn(c).width, b.getColumn(c).width, `column ${c} width`);
  assert.equal(a.getCell("G2").value.formula, "ROUND(E2*F2,2)"); // AMT is a formula

  const flagged = await reviewedBuild({ accepted: [] });
  assert.ok(flagged.unresolved > 0);
  const withReview = new ExcelJS.Workbook();
  await withReview.xlsx.load(await buildFuelWorkbookBuffer({ sheetName: flagged.period.sheetName, rows: flagged.rows, review: flagged.flags }));
  assert.deepEqual(withReview.worksheets.map((w) => w.name), ["JULY 26", "Review"]);
  assert.equal(withReview.getWorksheet("JULY 26").columnCount, 10);
  assert.equal(withReview.getWorksheet("Review").rowCount, flagged.flags.length + 1);
});

test("fuel register API: build and export; unresolved flags need Export anyway", { skip }, async () => {
  const { pages, accepted } = JSON.parse(await readFile(reviewed, "utf8"));
  const request = (body) => new Request("http://x/", { method: "POST", body: JSON.stringify({ reading: { pages }, financialYear, narrationDate, ...body }) });
  const built = await (await handleFuelBuild(request({ accepted }))).json();
  assert.deepEqual([built.rows.length, built.unresolved, built.period.label], [97, 0, "July 2026"]);
  assert.equal((await handleFuelBuild(request({ financialYear: "bad" }))).status, 422);

  const sheets = async (response) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await response.arrayBuffer()));
    return wb.worksheets.map((w) => w.name);
  };
  assert.deepEqual(await sheets(await handleFuelExport(request({ accepted }))), ["JULY 26"]);
  const blocked = await handleFuelExport(request({ accepted: [] }));
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "UNRESOLVED_FLAGS");
  assert.deepEqual(await sheets(await handleFuelExport(request({ accepted: [], exportAnyway: true }))), ["JULY 26", "Review"]);
});

test("fuel register reader: every page once, register and rates pages a second time, lubricant page not again; calls counted", { skip: existsSync(join(dir, "july26_register.pdf")) && existsSync(raw) ? false : "needs fixtures/invoices/jigeesha/" }, async () => {
  const saved = await loadReading(raw);
  const calls = { first: 0, second: 0 };
  const answer = (which, pages) => ({
    complete: async ({ system, messages }) => {
      calls[which]++;
      const n = Number(/page (\d+) of/.exec(messages[0].content.at(-1).text)[1]);
      return { text: JSON.stringify({ pages: [pages.find((p) => p.page === n)] }), usage: { model: which } };
    },
  });
  const { readFuelRegister } = await import("../../src/invoice/fuelRegister.js");
  const out = await readFuelRegister({ path: join(dir, "july26_register.pdf") }, { provider: answer("first", saved.pages), secondProvider: answer("second", saved.second.pages) });
  assert.deepEqual(out.calls, { first: 7, second: 6, total: 13 });
  assert.deepEqual(calls, { first: 7, second: 6 });
  assert.equal(out.images.length, 7);
  assert.deepEqual(out.reading.second.pages.map((p) => p.page), [1, 2, 3, 4, 5, 7]); // page 6 (lubricants) is not read again
});
