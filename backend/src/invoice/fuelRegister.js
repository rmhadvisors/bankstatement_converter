// "Fuel sales register" document type: one scanned monthly register PDF (a page per product/tank,
// 31 day rows each, plus a handwritten rates page) -> Tally import rows. Every register page and the
// rates page is read twice by Gemini (two different prompts, optionally two models); everything after
// that is plain code, so it is testable from a saved reading. A number is never changed to make a
// check pass: a failed check or a disagreement between the two readings becomes a review reason, and
// a person decides (edit the value, or accept it as read).
import { readFile } from "node:fs/promises";
import { prepareInvoiceFile } from "./images.js";
import { geminiProvider } from "./gemini.js";

// Editable per-party config (item/ledger can be overridden per user, see applyMapping).
// `register` = which register page (HSD pages are taken in page order: the first is tank 1, the
// second tank 2), `rate` = which line of the rates page prices it. Output order within a day is the
// order of `products`.
const FUEL_PARTIES = {
  "JIGEESHA AUTO SERVICES": {
    entryType: "IMPORT",
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
const COLS = ["salesByMeter", "pumpTest", "netSales", "cumulative"];
const COL_LABEL = { salesByMeter: "sales by meter", pumpTest: "pump test", netSales: "net sales", cumulative: "cumulative" };
const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
                unreadable: { type: "array", items: { type: "string", enum: COLS } },
              },
              required: ["day", ...COLS, "unreadable"],
              propertyOrdering: ["day", ...COLS, "unreadable"],
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

const PAGE_RULES = `You are given ONE page of the register. Return exactly one entry in "pages" with its page number (1-based, as told) and "kind":
- "register": a table with one row per day of the month (31 rows) for one product. Set "product": MS (petrol), MSP (power petrol), HSD (diesel; a second diesel page is also HSD), HSDT (turbo diesel, "HSD-T"), from the handwritten product name at the top. Set "month" (1-12) from the handwritten month heading.
- "rates": a handwritten list of prices per litre. Put one entry per line in "rates": product (PL / petrol = MS, HSD = HSD, HSD-T = HSDT, MSP / power = MSP), the label exactly as written, and the rate.
- "other": anything else (for example a lubricant list). Put a few words describing it in "description" and leave rows and rates empty.
Use "" for description of register and rates pages. Use null where a cell holds a dash or is empty. If a cell has a number you cannot read with confidence, use null and list the column name in "unreadable". Copy numbers exactly as written; never calculate, correct or fill in a number, even if it looks inconsistent. Return one row for each day 1 to 31 in the table.`;
const COLUMNS = `"SALES BY METER" (salesByMeter), "PUMP TEST" (pumpTest), "NET SALES BY METER" (netSales) and "CUMMULATIVE SALES" (cumulative)`;

// Two different ways of reading the same page: row by row, then column by column.
const FIRST_PROMPT = `You transcribe a scanned monthly fuel-pump sales register (handwritten, Hindi/English headings). ${PAGE_RULES}
For each register row copy exactly what is printed in four columns: ${COLUMNS}. Read digit by digit; handwritten 6/8, 1/7 and 3/5 are easy to confuse, so look at each digit's shape closely.`;
const SECOND_PROMPT = `Independent second reading of a handwritten fuel-pump sales register page (Hindi/English headings). ${PAGE_RULES}
Work one column at a time, top to bottom: first the whole ${COLUMNS.split(",")[0]} column for days 1 to 31, then PUMP TEST, then NET SALES BY METER, then CUMMULATIVE SALES. For every number write the digits you actually see in that cell, comparing each digit with the other digits in the same column; do not use the other columns to guess a digit.`;

const fuelError = (code, message) => Object.assign(new Error(message), { code });

// ---- reading ----

// file: { path }. Every page is read once (all pages), then register and rates pages a second time with
// another prompt (and GEMINI_MODEL_HANDWRITTEN when set). Returns the raw reading plus the page images
// (for the review screen) and how many Gemini calls were made. One call per page: a register page is
// ~160 handwritten numbers and the model reads them more accurately alone.
async function readFuelRegister(file, { provider = geminiProvider(), secondProvider = geminiProvider({ model: process.env.GEMINI_MODEL_HANDWRITTEN || undefined }) } = {}) {
  const prepared = await prepareInvoiceFile(file.path, { longSide: 3000 });
  if (prepared.kind !== "images") throw fuelError("FUEL_REGISTER_NOT_SCANNED", "The fuel sales register is expected to be a scanned PDF (page images).");
  const usage = [];
  const readPage = async (llm, system, image, number) => {
    const content = [
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: Buffer.from(image.data).toString("base64") } },
      { type: "text", text: `This is page ${number} of ${prepared.images.length} of the register. Transcribe it.` },
    ];
    const { text, usage: used } = await llm.complete({ system, messages: [{ role: "user", content }], responseSchema: REGISTER_SCHEMA });
    usage.push(used);
    let page;
    try {
      page = JSON.parse(text).pages?.[0];
    } catch {
      page = null;
    }
    if (!page) throw fuelError("FUEL_REGISTER_BAD_REPLY", `The reader's answer for page ${number} was not usable.`);
    return { ...page, page: number };
  };

  const first = await Promise.all(prepared.images.map((image, i) => readPage(provider, FIRST_PROMPT, image, i + 1)));
  // The lubricant page (and any other page only classified as "other") is not read again.
  const again = first.filter((p) => p.kind === "register" || p.kind === "rates");
  const second = await Promise.all(
    again.map((p) => readPage(secondProvider, SECOND_PROMPT, prepared.images[p.page - 1], p.page).catch((error) => ({ page: p.page, failed: error.code ?? "error" }))),
  );
  return {
    reading: { pages: first, second: { pages: second } },
    images: prepared.images,
    calls: { first: first.length, second: again.length, total: first.length + again.length },
    usage,
  };
}

const loadReading = async (path) => JSON.parse(await readFile(path, "utf8"));

// ---- helpers ----

const num = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const present = (n) => typeof n === "number" && Number.isFinite(n);
const show = (n) => (present(n) ? num(n) : "blank");
// Amount in paise arithmetic: integer qty * integer paise, so ROUND(qty*rate, 2) has no float noise.
const amount = (qty, rate) => Math.round(qty * Math.round(rate * 100)) / 100;
const pad = (n) => String(n).padStart(2, "0");
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const ddmmyyyy = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
// "YYYY-MM-DD" (a date input) is taken as that calendar day, not as UTC midnight.
const toDate = (d) => (d instanceof Date ? d : /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? new Date(...String(d).split("-").map((n, i) => (i === 1 ? n - 1 : Number(n)))) : new Date(d));
const oneDigitApart = (a, b) => {
  const [x, y] = [String(a), String(b)];
  return x.length === y.length && [...x].filter((ch, i) => ch !== y[i]).length === 1;
};

// Financial year "2026-27" + month -> calendar year: Apr-Dec = start year, Jan-Mar = start year + 1.
function financialYearToYear(financialYear, month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(financialYear ?? ""));
  const start = match && Number(match[1]);
  if (!match || (start + 1) % 100 !== Number(match[2])) throw fuelError("FUEL_REGISTER_BAD_FY", `"${financialYear}" is not a financial year like 2026-27.`);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw fuelError("FUEL_REGISTER_NO_MONTH", "The month of the register could not be read from the pages.");
  return month >= 4 ? start : start + 1;
}

// Edited item/ledger names from the party settings: [{ register, nth, item, ledger }] over the defaults.
function applyMapping(config, mapping = []) {
  const products = config.products.map((product) => {
    const own = mapping.find((m) => m.register === product.register && m.nth === product.nth);
    const text = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
    return own ? { ...product, item: text(own.item, product.item), ledger: text(own.ledger, product.ledger) } : product;
  });
  return { ...config, products };
}

// The two readings of each page -> one page list: the first reading's values, plus `alt` where the
// second reading differs (register rows: { column: value }; rates lines: the other rate).
function mergeReads(reading) {
  const pages = structuredClone(reading.pages ?? []);
  if (!reading.second) return pages;
  const second = new Map((reading.second.pages ?? []).map((p) => [p.page, p]));
  for (const page of pages) {
    if (page.kind !== "register" && page.kind !== "rates") continue;
    const other = second.get(page.page);
    if (!other || other.failed) {
      page.secondRead = "missing";
      continue;
    }
    page.secondRead = "ok";
    if (other.kind !== page.kind || (other.product ?? null) !== (page.product ?? null)) page.otherClass = { kind: other.kind, product: other.product ?? null };
    if (page.kind === "register") {
      const rows = new Map((other.rows ?? []).map((r) => [r.day, r]));
      for (const row of page.rows ?? []) {
        const there = rows.get(row.day);
        const alt = {};
        for (const col of COLS) if ((row[col] ?? null) !== (there?.[col] ?? null)) alt[col] = there?.[col] ?? null;
        if (Object.keys(alt).length) row.alt = alt;
      }
    } else {
      const rates = new Map((other.rates ?? []).map((r) => [r.product, r.rate ?? null]));
      for (const line of page.rates ?? []) if ((line.rate ?? null) !== (rates.get(line.product) ?? null)) line.alt = rates.get(line.product) ?? null;
    }
  }
  return pages;
}

// ---- building rows + checks ----

// reading + options -> { period, rows, tables, rates, flags, ignoredPages, status, unresolved }
//  rows (the Tally rows): [{ date, sr, party, item, qty, rate, amt, vch, ledger, narration, review: [reason, ...] }]
//  tables (the review screen): per product, 31 day rows with their cell flags
//  flags: [{ id, kind, product, day, col, reason, values?, suggestion?, registerError, accepted }]
// Options: financialYear (e.g. "2026-27") gives the year; month overrides the page headings; ratesOverride
// { HSD: 98.24 } and the `edited` marks on rows come from the review screen; accepted [{ id, note }].
function buildFuelRegister(reading, { party = "JIGEESHA AUTO SERVICES", narrationDate = new Date(), financialYear, month, year, ratesOverride = {}, mapping, accepted = [] } = {}) {
  const defaults = FUEL_PARTIES[party];
  if (!defaults) throw fuelError("FUEL_REGISTER_PARTY", `"${party}" has no fuel register settings.`);
  const config = applyMapping(defaults, mapping);
  const pages = mergeReads(reading);
  const acceptedNotes = new Map(accepted.map((a) => [a.id, String(a.note ?? "")]));
  const flags = [];
  const cellFlags = new Map(); // "item|day|col" -> flag ids
  const flag = ({ kind, product = null, day = null, col = null, rateKey = null, reason, values = null, cells = [] }) => {
    const id = [kind, product ?? "", day ?? "", col ?? "", rateKey ?? ""].join("|");
    let found = flags.find((f) => f.id === id);
    if (!found) {
      found = { id, kind, product, day, col, rateKey, reason, values, suggestion: null, registerError: false, accepted: acceptedNotes.has(id) ? acceptedNotes.get(id) : null };
      flags.push(found);
    }
    for (const [d, c] of cells) {
      const key = `${product}|${d}|${c}`;
      cellFlags.set(key, [...(cellFlags.get(key) ?? []), id]);
    }
    return found;
  };

  // Month: the page headings (the most common one), unless the caller overrides it. Year: from the financial year.
  const months = pages.filter((p) => p.kind === "register" && p.month).map((p) => p.month);
  const distinct = [...new Set(months)];
  const headMonth = distinct.sort((a, b) => months.filter((m) => m === b).length - months.filter((m) => m === a).length)[0];
  if (distinct.length > 1) flag({ kind: "month", reason: `The register pages show different months (${distinct.join(", ")}); using ${headMonth}.` });
  month ??= headMonth;
  year ??= financialYearToYear(financialYear, month);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLetter = String.fromCharCode(65 + ((month - 4 + 12) % 12)); // April = A ... March = L
  const period = { month, year, financialYear: financialYear ?? null, label: `${MONTH_LABELS[month - 1]} ${year}`, sheetName: `${MONTH_NAMES[month - 1]} ${String(year).slice(2)}` };

  const ignoredPages = pages.filter((p) => p.kind === "other").map((p) => ({ page: p.page, description: p.description }));
  for (const p of pages.filter((p) => p.otherClass)) {
    flag({ kind: "page-class", reason: `Page ${p.page}: the two readings disagree on what the page is (${p.kind}${p.product ? ` ${p.product}` : ""} vs ${p.otherClass.kind}${p.otherClass.product ? ` ${p.otherClass.product}` : ""}); the first reading was used.` });
  }

  // Rates: read value, second reading, and the review screen's edit.
  const rates = {};
  for (const page of pages.filter((p) => p.kind === "rates")) {
    for (const line of page.rates ?? []) if (present(line.rate)) rates[line.product] = { read: line.rate, alt: line.alt, value: line.rate };
    if (page.secondRead === "missing") flag({ kind: "single-read", reason: `The second reading of the rates page (page ${page.page}) failed, so the rates were read once only.` });
  }
  for (const code of PRODUCT_CODES) {
    const edited = present(ratesOverride[code]);
    if (edited) rates[code] = { ...rates[code], value: ratesOverride[code], edited: true };
    const entry = rates[code];
    if (entry && !edited && entry.alt !== undefined) {
      flag({ kind: "rate-disagree", rateKey: code, reason: `The ${RATE_LABELS[code]} rate reads ${show(entry.read)} on the first reading and ${show(entry.alt)} on the second.`, values: { first: entry.read, second: entry.alt } });
    }
  }

  // Register pages -> one slot per product in the party config, in config order.
  const used = new Map();
  const slots = config.products.map((product) => ({ ...product, page: pages.filter((p) => p.kind === "register" && p.product === product.register)[product.nth - 1] }));
  for (const p of pages.filter((p) => p.kind === "register")) used.set(p.product, (used.get(p.product) ?? 0) + 1);
  for (const [code, count] of used) {
    const wanted = config.products.filter((p) => p.register === code).length;
    if (count > wanted) flag({ kind: "extra-page", reason: `The PDF has ${count} ${code} register pages but only ${wanted} ${wanted === 1 ? "is" : "are"} set up for this party; the extra page was not used.` });
    if (!wanted) flag({ kind: "extra-page", reason: `A ${code} register page was found but this party has no setting for it; it was not used.` });
  }

  const byDay = new Map(); // day -> [{ slot, qty }]
  const tables = [];
  for (const slot of slots) {
    if (!slot.page) {
      flag({ kind: "no-page", product: slot.item, reason: `No ${slot.register} register page was found for ${slot.item}.` });
      continue;
    }
    const product = slot.item;
    if (slot.page.secondRead === "missing") flag({ kind: "single-read", product, reason: `The second reading of the ${product} page (page ${slot.page.page}) failed, so it was read once only.` });
    const seen = new Set();
    const table = [];
    let running = 0;
    let previousCumulative = 0;
    let broken = false;
    for (const row of [...(slot.page.rows ?? [])].sort((a, b) => a.day - b.day)) {
      const { day } = row;
      const where = dayLabel(product, day);
      if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
        flag({ kind: "bad-day", product, day, reason: `${product}: a row is marked day ${day}, which is not a day of that month; it was not used.` });
        continue;
      }
      if (seen.has(day)) {
        flag({ kind: "dup-day", product, day, reason: `${where}: the day appears twice on the page; the second row was not used.` });
        continue;
      }
      seen.add(day);
      const edited = new Set(row.edited ?? []);
      const { salesByMeter: meter, pumpTest: pump, netSales: net, cumulative } = row;
      const here = []; // flags raised for this day
      const raise = (spec) => here.push(flag({ ...spec, product, day }));

      for (const col of row.unreadable ?? []) if (!edited.has(col)) raise({ kind: "unreadable", col, cells: [[day, col]], reason: `${where}: could not read ${COL_LABEL[col]}.` });
      for (const col of COLS) {
        if (row.alt && col in row.alt && !edited.has(col)) {
          raise({ kind: "disagree", col, cells: [[day, col]], values: { first: row[col] ?? null, second: row.alt[col] }, reason: `${where}: ${COL_LABEL[col]} reads ${show(row[col])} on the first reading and ${show(row.alt[col])} on the second.` });
        }
      }
      if (present(meter) && present(pump) && present(net) && meter - pump !== net) {
        raise({ kind: "meter-test", cells: [[day, "salesByMeter"], [day, "pumpTest"], [day, "netSales"]], reason: `${where}: sales by meter ${num(meter)} minus pump test ${num(pump)} is ${num(meter - pump)}, but net sales reads ${num(net)}.` });
      }
      if (present(net) && net !== 0) {
        running += net;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ slot, qty: net });
      } else if (!(row.unreadable ?? []).includes("netSales") && present(cumulative) && cumulative !== previousCumulative) {
        raise({ kind: "blank-net", cells: [[day, "netSales"], [day, "cumulative"]], reason: `${where}: the cumulative sales changed to ${num(cumulative)} but net sales is blank.` });
      }
      let chain = null;
      if (present(cumulative)) {
        if (!broken && cumulative !== running) {
          broken = true;
          const diff = cumulative - running;
          chain = flag({
            kind: "chain",
            product,
            day,
            cells: [[day, "cumulative"], [day, "netSales"]],
            reason: `${product}: from day ${day} the printed cumulative sales (${num(cumulative)}) is ${num(Math.abs(diff))} ${diff < 0 ? "lower" : "higher"} than the running total of net sales (${num(running)}).`,
          });
          here.push(chain);
        }
      }
      // A flagged net-sales cell gets a one-click suggestion from the cumulative column (today minus the
      // day before) when that is one misread digit away from the read value, or equals the second reading.
      // Never applied here. If the net-sales cell has no other doubt and the suggestion is not plausible,
      // the printed total itself is what looks wrong (a register error).
      const netFlags = here.filter((f) => (cellFlags.get(`${product}|${day}|netSales`) ?? []).includes(f.id));
      if (netFlags.length) {
        const s = present(cumulative) && present(net) ? cumulative - previousCumulative : null;
        const plausible = s !== null && Number.isInteger(s) && s >= 0 && s !== net && (oneDigitApart(s, net) || s === row.alt?.netSales);
        if (plausible) {
          const suggestion = { col: "netSales", day, value: s, reason: `The cumulative column goes from ${num(previousCumulative)} to ${num(cumulative)}, which is ${num(s)}.` };
          for (const f of netFlags) f.suggestion = suggestion;
        } else if (chain && netFlags.length === 1) {
          chain.registerError = true;
          chain.reason += " Register total looks wrong, rows kept as read.";
        }
      }
      if (present(cumulative)) previousCumulative = cumulative;
      table.push({ day, salesByMeter: meter ?? null, pumpTest: pump ?? null, netSales: net ?? null, cumulative: cumulative ?? null, unreadable: row.unreadable ?? [], alt: row.alt, edited: row.edited ?? [] });
    }
    for (let d = 1; d <= daysInMonth; d++) if (!seen.has(d)) flag({ kind: "missing-day", product, day: d, reason: `${dayLabel(product, d)}: the register page has no row for this day.` });
    tables.push({ item: product, register: slot.register, page: slot.page.page, rateKey: slot.rate, rows: table });
  }

  // Tally rows: one per product per day with net sales, in day then party-config order.
  const rows = [];
  const narration = `BEING SALES RECORDED ON ${ddmmyyyy(toDate(narrationDate))}`;
  const missingRates = new Set();
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const { slot, qty } of config.products.map((p) => byDay.get(day).find((e) => e.slot.item === p.item)).filter(Boolean)) {
      const rate = rates[slot.rate]?.value ?? null;
      if (rate === null && !missingRates.has(slot.rate)) {
        missingRates.add(slot.rate);
        flag({ kind: "no-rate", rateKey: slot.rate, reason: `The rates page has no rate for ${RATE_LABELS[slot.rate]}; its rows have no rate or amount.` });
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
  if (!pages.some((p) => p.kind === "rates") && !PRODUCT_CODES.some((c) => present(ratesOverride[c]))) flag({ kind: "no-rates-page", reason: "No rates page was found, so no row has a rate or amount." });

  // Review screen tables: rate, amount and the flags on each cell.
  for (const table of tables) {
    const rate = rates[table.rateKey]?.value ?? null;
    for (const row of table.rows) {
      row.rate = rate;
      row.amount = present(row.netSales) && row.netSales !== 0 && rate !== null ? amount(row.netSales, rate) : null;
      row.cells = Object.fromEntries(COLS.map((col) => [col, cellFlags.get(`${table.item}|${row.day}|${col}`) ?? []]).filter(([, ids]) => ids.length));
    }
  }

  // A reason sits on the row it names (product + day, or the rate it is about); reasons about the whole
  // page or month go on every row. Accepted flags are not review reasons any more.
  const open = flags.filter((f) => f.accepted === null);
  for (const f of open) {
    for (const r of rows) {
      const slot = config.products.find((p) => p.item === r.item);
      const sameProduct = f.product === null || r.item === f.product;
      const sameRate = f.rateKey === null || slot?.rate === f.rateKey;
      if (sameProduct && sameRate && (f.day === null || Number(r.date.slice(8)) === f.day)) r.review.push(f.reason);
    }
  }
  return { period, rows, tables, rates, flags, ignoredPages, unresolved: open.length, status: open.length ? "NEEDS REVIEW" : "OK", entryType: config.entryType, mapping: config.products };
}

const dayLabel = (product, day) => `${product}, day ${day}`;

export { FUEL_PARTIES, REGISTER_SCHEMA, applyMapping, buildFuelRegister, financialYearToYear, loadReading, mergeReads, readFuelRegister };
