// How each supplier is entered in Tally. Matched by GSTIN first, then by a fuzzy name match
// ("ABC POWER PAINT" in the list = "Abc Powder paint" on the invoice). The party list is per-user
// data (Supabase invoice_parties); no client names live in the code.
import { cleanGstin } from "./gstin.js";

const ENTRY_TYPES = ["STOCK", "NORMAL", "TCS", "IMPORT"];
const NAME_MATCH_THRESHOLD = 0.85;

const NOISE_WORDS = new Set(["M", "S", "MS", "THE", "PVT", "PRIVATE", "LTD", "LIMITED", "CO", "COMPANY", "AND"]);

function normalizePartyName(name) {
  return String(name ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .split(/[^A-Z0-9]+/)
    .filter((w) => w && !NOISE_WORDS.has(w))
    .join(" ");
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

function nameSimilarity(a, b) {
  const x = normalizePartyName(a);
  const y = normalizePartyName(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// -> { party, matchedBy: "gstin" | "name", score } or null
// ponytail: linear scan with O(len^2) Levenshtein per party; fine for hundreds of parties, index by GSTIN/trigram if it grows to thousands.
function matchParty(supplier, parties) {
  const gstin = supplier?.gstin ? cleanGstin(supplier.gstin) : null;
  if (gstin) {
    const party = parties.find((p) => p.gstin && cleanGstin(p.gstin) === gstin);
    if (party) return { party, matchedBy: "gstin", score: 1 };
  }
  let best = null;
  for (const party of parties) {
    const score = nameSimilarity(party.name, supplier?.name);
    if (score >= NAME_MATCH_THRESHOLD && (!best || score > best.score)) best = { party, matchedBy: "name", score };
  }
  return best;
}

const LIQUOR = /\b(liquor|beer|whisk(?:e)?y|wine|rum|vodka|gin|brandy|imfl|bar|pint|peg)\b/i;
const SERVICE = /\b(work|works|labou?r|service|services|repair|construction|contractor|installation|fitting|cutting|levelling|transport|charges|consultancy)\b/i;

// Default entry type for a party that isn't in the settings yet; the user confirms it on the review screen.
function guessEntryType(invoice) {
  const descriptions = (invoice.lineItems ?? []).map((l) => l.description ?? "").join(" ");
  const supplierName = invoice.supplier?.name ?? "";
  if (LIQUOR.test(descriptions) || LIQUOR.test(supplierName)) return { entryType: "TCS", reason: "liquor/bar items" };
  const sac = (invoice.lineItems ?? []).some((l) => /^99/.test(l.hsnSac ?? ""));
  if (sac || SERVICE.test(descriptions) || SERVICE.test(supplierName)) return { entryType: "NORMAL", reason: "services/works" };
  const goods = (invoice.lineItems ?? []).some((l) => l.hsnSac || (l.qty != null && l.rate != null));
  return goods ? { entryType: "STOCK", reason: "item-wise goods" } : { entryType: "NORMAL", reason: "no item details" };
}

export { ENTRY_TYPES, guessEntryType, matchParty, nameSimilarity, normalizePartyName };
