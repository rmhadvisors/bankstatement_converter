// Per-client item -> HSN dictionary, kept in a git-ignored JSON you can edit (.invoice-data/hsn-<client>.json).
//   "manual":  { "pvc flooring": "3918" }                    your entries, always used
//   "learned": { "film": { "3920": ["1051|02/12/2025|0", ...] } }   HSNs read from bills; the ids are the lines they came from
// A learned entry is used only with 2 or more different source lines and no other HSN seen for that item.
// Off under tests (INVOICE_HSN_DICTIONARY=off or node --test) so they never touch a real file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { itemKey, validHsn } from "./rules.js";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".invoice-data");
const enabled = () => process.env.INVOICE_HSN_DICTIONARY === "on" || (process.env.INVOICE_HSN_DICTIONARY !== "off" && !process.env.NODE_TEST_CONTEXT);
const fileOf = () => join(process.env.INVOICE_DATA_DIR || DEFAULT_DIR, `hsn-${(process.env.INVOICE_CLIENT || "default").replace(/[^\w-]/g, "")}.json`);

function read() {
  try {
    const data = JSON.parse(readFileSync(fileOf(), "utf8"));
    return { manual: data.manual ?? {}, learned: data.learned ?? {} };
  } catch {
    return { manual: {}, learned: {} };
  }
}

// -> Map(item keyword -> HSN)
function loadDictionary() {
  if (!enabled()) return new Map();
  const { manual, learned } = read();
  const map = new Map();
  for (const [key, byHsn] of Object.entries(learned)) {
    const seen = Object.entries(byHsn).filter(([, ids]) => ids.length);
    if (seen.length === 1 && seen[0][1].length >= 2) map.set(key, seen[0][0]);
  }
  for (const [key, hsn] of Object.entries(manual)) if (validHsn(hsn)) map.set(itemKey(key) || key, String(hsn));
  return map;
}

// invoice: a reading BEFORE any HSN was filled in by rules (only HSNs written on the bill are learned).
function learnFrom(invoice) {
  if (!enabled() || !invoice.invoiceNo) return;
  const data = read();
  let changed = false;
  (invoice.lineItems ?? []).forEach((line, i) => {
    const key = itemKey(line.description);
    if (!key || !validHsn(line.hsnSac)) return;
    const id = `${invoice.invoiceNo}|${invoice.invoiceDate ?? ""}|${i}`;
    const ids = ((data.learned[key] ??= {})[line.hsnSac] ??= []);
    if (!ids.includes(id)) (ids.push(id), (changed = true));
  });
  if (!changed) return;
  const file = fileOf();
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

export { learnFrom, loadDictionary };
