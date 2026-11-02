// "Fuel sales register" document type: one scanned monthly register PDF (a page per product/tank,
// 31 day rows each, plus a handwritten rates page) -> Tally import rows. Reading is done by the
// Gemini provider (one call, page images, structured JSON); everything after that is plain code, so
// it is testable from a saved reading. A number is never changed to make a check pass: a failed
// check becomes a plain-sentence review reason instead.
import { readFile } from "node:fs/promises";
import { prepareInvoiceFile } from "./images.js";
import { geminiProvider } from "./gemini.js";

// Editable per-party config. `register` = which register page (HSD pages are taken in page order:
// the first is tank 1, the second tank 2), `rate` = which line of the rates page prices it.
// Output order within a day is the order of `products`.
const FUEL_PARTIES = {
  "JIGEESHA AUTO SERVICES": {
    party: "Cash",
    vch: "Sales",
    products: [
      { register: "HSD", nth: 1, item: "High Speed Diesel-1", ledger: "Non GST Sales Diesel", rate: "HSD" },
      { register: "HSD", nth: 2, item: "High Speed Diesel-2", ledger: "Non GST Sales Diesel", rate: "HSD" },
      { register: "MS", nth: 1, item: "Petrol", ledger: "Non GST Sales Petrol", rate: "MS" },
      { register: "MSP", nth: 1, item: "Power Petrol", ledger: "Non GST Sales Power Petrol", rate: "MSP" },
      { register: "HSDT", nth: 1, item: "HIGH SPEED DIESEL (TURBO)", ledger: "Non GST Sales Diesel", rate: "HSDT" },
    ],
  },
};

const PRODUCT_CODES = ["HSD", "MS", "MSP", "HSDT"];
const RATE_LABELS = { MS: "petrol (MS / PL)", HSD: "diesel (HSD)", HSDT: "turbo diesel (HSD-T)", MSP: "power petrol (MSP)" };
const PAGE_KINDS = ["register", "rates", "other"];

const cell = { type: "number", nullable: true };
const REGISTER_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          kind: { type: "string", enum: PAGE_KINDS },
          product: { type: "string", enum: PRODUCT_CODES, nullable: true },
          month: { type: "integer", nullable: true },
          description: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "integer" },
                salesByMeter: cell,
                pumpTest: cell,
                netSales: cell,
                cumulative: cell,
                unreadable: { type: "array", items: { type: "string", enum: ["salesByMeter", "pumpTest", "netSales", "cumulative"] } },
              },
              required: ["day", "salesByMeter", "pumpTest", "netSales", "cumulative", "unreadable"],
              propertyOrdering: ["day", "salesByMeter", "pumpTest", "netSales", "cumulative", "unreadable"],
            },
          },
          rates: {
            type: "array",
            items: {
              type: "object",
              properties: { product: { type: "string", enum: PRODUCT_CODES }, label: { type: "string" }, rate: cell },
              required: ["product", "label", "rate"],
              propertyOrdering: ["product", "label", "rate"],
            },
          },
        },
        required: ["page", "kind", "product", "month", "description", "rows", "rates"],
        propertyOrdering: ["page", "kind", "product", "month", "description", "rows", "rates"],
      },
    },
  },
  required: ["pages"],
};

const SYSTEM_PROMPT = `You transcribe a scanned monthly fuel-pump sales register (handwritten, Hindi/English headings). You are given ONE page of the register. Return exactly one entry in "pages" with its page number (1-based, as told) and "kind":
- "register": a table with one row per day of the month (31 rows) for one product. Set "product": MS (petrol), MSP (power petrol), HSD (diesel; a second diesel page is also HSD), HSDT (turbo diesel, "HSD-T"), from the handwritten product name at the top. Set "month" (1-12) from the handwritten month heading.
- "rates": a handwritten list of prices per litre. Put one entry per line in "rates": product (PL / petrol = MS, HSD = HSD, HSD-T = HSDT, MSP / power = MSP), the label exactly as written, and the rate.
- "other": anything else (for example a lubricant list). Put a few words describing it in "description" and leave rows and rates empty.
For each register row copy exactly what is printed in four columns: "SALES BY METER" (salesByMeter), "PUMP TEST" (pumpTest), "NET SALES BY METER" (netSales) and "CUMMULATIVE SALES" (cumulative). Use null where the cell holds a dash or is empty. If a cell has a number you cannot read with confidence, use null and list the column name in "unreadable". Copy numbers exactly as written; never calculate, correct or fill in a number, even if it looks inconsistent. Return one row for each day 1 to 31 in the table. Read digit by digit; handwritten 6/8, 1/7 and 3/5 are easy to confuse, so look at each digit's shape closely. Use "" for description of register and rates pages.`;

const fuelError = (code, message) => Object.assign(new Error(message), { code });

// ---- reading ----

// file: { path }. Returns the reading { pages: [...] } as the model gave it. One call per page: a
// register page is ~160 handwritten numbers and the model reads them more accurately alone.
async function readFuelRegister(file, { provider = geminiProvider() } = {}) {
  const prepared = await prepareInvoiceFile(file.path, { longSide: 3000 });
  if (prepared.kind !== "images") throw fuelError("FUEL_REGISTER_NOT_SCANNED", "The fuel sales register is expected to be a scanned PDF (page images).");
  const reads = await Promise.all(
    prepared.images.map(async (image, i) => {
      const content = [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: Buffer.from(image.data).toString("base64") } },
        { type: "text", text: `This is page ${i + 1} of ${prepared.images.length} of the register. Transcribe it.` },
      ];
      const { text, usage } = await provider.complete({ system: SYSTEM_PROMPT, messages: [{ role: "user", content }], responseSchema: REGISTER_SCHEMA });
      let page;
      try {
        page = JSON.parse(text).pages?.[0];
      } catch {
        page = null;
      }
      if (!page) throw fuelError("FUEL_REGISTER_BAD_REPLY", `The reader's answer for page ${i + 1} was not usable.`);
      return { page: { ...page, page: i + 1 }, usage };
    }),
  );
  return { reading: { pages: reads.map((r) => r.page) }, usage: reads.map((r) => r.usage), pageCount: prepared.images.length };
}

const loadReading = async (path) => JSON.parse(await readFile(path, "utf8"));

// ---- building rows + checks ----

const num = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
// Amount in paise arithmetic: integer qty * integer paise, so ROUND(qty*rate, 2) has no float noise.
const amount = (qty, rate) => Math.round(qty * Math.round(rate * 100)) / 100;
const pad = (n) => String(n).padStart(2, "0");
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const ddmmyyyy = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
const present = (n) => typeof n === "number" && Number.isFinite(n);

// reading + party config -> { period, rows, flags, ignoredPages, status }
//  rows: [{ date, sr, party, item, qty, rate, amt, vch, ledger, narration, review: [reason, ...] }]
//  flags: [{ product: item|null, day: number|null, reason }]  (plain sentences)
function buildFuelRegister(reading, { party = "JIGEESHA AUTO SERVICES", narrationDate = new Date(), month, year } = {}) {
  const config = FUEL_PARTIES[party];
  if (!config) throw fuelError("FUEL_REGISTER_PARTY", `"${party}" has no fuel register settings.`);
  const flags = [];
  const flag = (product, day, reason) => flags.push({ product, day, reason });
  const pages = reading.pages ?? [];

  // Month: the page headings (the most common one), unless the caller (review screen) overrides it.
  // The year is not read (handwritten years come out unreliably): it is the latest year, up to the
  // narration date's, in which that month is not later than the narration date.
  const months = pages.filter((p) => p.kind === "register" && p.month).map((p) => p.month);
  const headMonth = [...new Set(months)].sort((a, b) => months.filter((m) => m === b).length - months.filter((m) => m === a).length)[0];
  if (new Set(months).size > 1) flag(null, null, `The register pages show different months (${[...new Set(months)].join(", ")}); using ${headMonth}.`);
  month ??= headMonth;
  if (!month) throw fuelError("FUEL_REGISTER_NO_MONTH", "The month of the register could not be read from the pages.");
  const narrated = narrationDate instanceof Date ? narrationDate : new Date(narrationDate);
  year ??= narrated.getFullYear() - (month > narrated.getMonth() + 1 ? 1 : 0);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLetter = String.fromCharCode(65 + ((month - 4 + 12) % 12)); // April = A ... March = L

  const ignoredPages = pages.filter((p) => p.kind === "other").map((p) => ({ page: p.page, description: p.description }));
  const rates = {};
  for (const page of pages.filter((p) => p.kind === "rates")) for (const r of page.rates ?? []) if (present(r.rate)) rates[r.product] = r.rate;

  // Register pages -> one slot per product in the party config, in config order.
  const used = new Map();
  const slots = config.products.map((product) => {
    const mine = pages.filter((p) => p.kind === "register" && p.product === product.register);
    return { ...product, page: mine[product.nth - 1] };
  });
  for (const p of pages.filter((p) => p.kind === "register")) used.set(p.product, (used.get(p.product) ?? 0) + 1);
  for (const [code, count] of used) {
    const wanted = config.products.filter((p) => p.register === code).length;
    if (count > wanted) flag(null, null, `The PDF has ${count} ${code} register pages but only ${wanted} ${wanted === 1 ? "is" : "are"} set up for this party; the extra page was not used.`);
    if (!wanted) flag(null, null, `A ${code} register page was found but this party has no setting for it; it was not used.`);
  }

  // Per product: day -> net sales, checks, then rows.
  const byDay = new Map(); // day -> [{ slot, qty }]
  for (const slot of slots) {
    if (!slot.page) {
      flag(slot.item, null, `No ${slot.register} register page was found for ${slot.item}.`);
      continue;
    }
    const seen = new Set();
    let running = 0;
    let previousCumulative = 0;
    let broken = false;
    const rows = [...(slot.page.rows ?? [])].sort((a, b) => a.day - b.day);
    for (const row of rows) {
      const { day } = row;
      const where = `${slot.item}, day ${day}`;
      if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
        flag(slot.item, day, `${slot.item}: a row is marked day ${day}, which is not a day of that month; it was not used.`);
        continue;
      }
      if (seen.has(day)) {
        flag(slot.item, day, `${where}: the day appears twice on the page; the second row was not used.`);
        continue;
      }
      seen.add(day);
      const unreadable = row.unreadable ?? [];
      if (unreadable.length) flag(slot.item, day, `${where}: could not read ${unreadable.join(", ")}.`);
      const { salesByMeter: meter, pumpTest: pump, netSales: net, cumulative } = row;
      if (present(meter) && present(pump) && present(net) && meter - pump !== net) {
        flag(slot.item, day, `${where}: sales by meter ${num(meter)} minus pump test ${num(pump)} is ${num(meter - pump)}, but net sales reads ${num(net)}.`);
      }
      if (present(net) && net !== 0) {
        running += net;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ slot, qty: net });
      } else if (!unreadable.includes("netSales") && present(cumulative) && cumulative !== previousCumulative) {
        flag(slot.item, day, `${where}: the cumulative sales changed to ${num(cumulative)} but net sales is blank.`);
      }
      if (present(cumulative)) {
        if (!broken && cumulative !== running) {
          broken = true;
          const diff = cumulative - running;
          flag(slot.item, day, `${slot.item}: from day ${day} the printed cumulative sales (${num(cumulative)}) is ${num(Math.abs(diff))} ${diff < 0 ? "lower" : "higher"} than the running total of net sales (${num(running)}).`);
        }
        previousCumulative = cumulative;
      }
    }
    for (let d = 1; d <= daysInMonth; d++) if (!seen.has(d)) flag(slot.item, d, `${slot.item}, day ${d}: the register page has no row for this day.`);
  }

  const rows = [];
  const narration = `BEING SALES RECORDED ON ${ddmmyyyy(narrationDate instanceof Date ? narrationDate : new Date(narrationDate))}`;
  const missingRates = new Set();
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const { slot, qty } of config.products.map((p) => byDay.get(day).find((e) => e.slot.item === p.item)).filter(Boolean)) {
      const rate = rates[slot.rate] ?? null;
      if (rate === null && !missingRates.has(slot.rate)) {
        missingRates.add(slot.rate);
        flag(null, null, `The rates page has no rate for ${RATE_LABELS[slot.rate]}; its rows have no rate or amount.`);
      }
      rows.push({
        date: iso(year, month, day),
        sr: `${monthLetter}${rows.length + 1}`,
        party: config.party,
        item: slot.item,
        qty,
        rate,
        amt: rate === null ? null : amount(qty, rate),
        vch: config.vch,
        ledger: slot.ledger,
        narration,
        review: [],
      });
    }
  }
  if (!pages.some((p) => p.kind === "rates")) flag(null, null, "No rates page was found, so no row has a rate or amount.");

  // A reason sits on the row it names (product + day); reasons about a whole page or the month go on every row of that product (or all rows).
  for (const f of flags) {
    for (const r of rows) {
      const sameProduct = f.product === null || r.item === f.product;
      if (sameProduct && (f.day === null || Number(r.date.slice(8)) === f.day)) r.review.push(f.reason);
    }
  }
  return { period: { month, year, sheetName: `${MONTH_NAMES[month - 1]} ${String(year).slice(2)}` }, rows, flags, ignoredPages, status: flags.length ? "NEEDS REVIEW" : "OK" };
}

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];

export { FUEL_PARTIES, REGISTER_SCHEMA, buildFuelRegister, loadReading, readFuelRegister };
