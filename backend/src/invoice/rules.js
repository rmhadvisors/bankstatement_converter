// Deterministic clean-up of an AI reading (Sarvam or Claude), before validation. These replace
// model guesses with values derived in code from what was read; written amounts are never changed.
const has = (n) => typeof n === "number" && Number.isFinite(n);
const round2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;

// HSN/SAC: digits only, 4, 6 or 8 long, chapter 01-97 (99 allowed for 6-digit SAC service codes).
function validHsn(value) {
  const text = String(value ?? "");
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(text)) return false;
  const chapter = Number(text.slice(0, 2));
  return (chapter >= 1 && chapter <= 97) || (chapter === 99 && text.length === 6);
}

// Item keywords for matching the same item across lines: description without numbers, units and filler words.
const ITEM_FILLER = new Set(["sf", "sft", "sqft", "sq", "ft", "mtr", "mtrs", "pc", "pcs", "nos", "no", "tin", "tins", "litre", "lit", "ltr", "ltrs", "per", "piece", "soft", "of", "the", "and", "p"]);
function itemKey(description) {
  const words = String(description ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !ITEM_FILLER.has(w));
  return words.join(" ");
}

// The numbers of a raw line in reading order: "68/SF flim 3920 55/- 3,740/-" -> [68, 3920, 55, 3740].
const rawNumbers = (text) => [...String(text ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => ({ text: m[0].replace(/,/g, ""), value: Number(m[0].replace(/,/g, "")) })).filter((n) => Number.isFinite(n.value));
const near = (a, b) => Math.abs(a - b) <= 1.0001;

// HSN (and a missing rate) from the line's own written text. A 4, 6 or 8 digit whole number is the HSN only if the
// remaining numbers still satisfy qty x rate = amount (tolerance 1). Exactly one such number, or nothing is taken.
// -> { hsn, rate } | null
function hsnFromRawLine(line, invoice) {
  const numbers = rawNumbers(line.rawLine);
  if (numbers.length < 3) return null;
  const invoiceDigits = String(invoice.invoiceNo ?? "").replace(/\D/g, "");
  const found = [];
  numbers.forEach((candidate, index) => {
    if (!validHsn(candidate.text) || index === numbers.length - 1) return;
    const year = candidate.text.length === 4 && Number(candidate.text) >= 1990 && Number(candidate.text) <= 2100;
    if (year || [line.qty, line.rate, line.amount, line.taxableValue].some((v) => has(v) && v === candidate.value) || candidate.text === invoiceDigits) return;
    const rest = numbers.filter((_, i) => i !== index);
    const amount = rest[rest.length - 1];
    if (has(line.amount) && !near(amount.value, line.amount)) return;
    for (let r = 1; r < rest.length - 1; r += 1) {
      if (index < numbers.indexOf(rest[r]) && rest.slice(0, r).some((qty) => near(qty.value * rest[r].value, amount.value))) {
        found.push({ hsn: candidate.text, rate: rest[r].value });
        break;
      }
    }
  });
  return found.length === 1 ? found[0] : null;
}

// "total area 337 sq ft", "966.45 sqft", "15 SQFT", "100 KGS"
const UNIT_SOURCE = String.raw`sq\.?\s*f(?:ee)?t|sq\.?\s*ft|sqft|sft|sq\.?\s*m(?:tr)?s?|sqm|r\.?\s*ft|rft|running\s*ft|kgs?|nos?|pcs|mtrs?|ltrs?|bags?|cft|brass`;
const QTY_IN_TEXT = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(${UNIT_SOURCE})\b`, "gi");
function normalizeUnit(unit) {
  const u = unit.toLowerCase().replace(/[\s.]/g, "");
  if (/^(sqft|sqfeet|sft)$/.test(u)) return "sqft";
  if (/^(sqm|sqmtr|sqmtrs|sqms)$/.test(u)) return "sqm";
  if (/^(rft|runningft)$/.test(u)) return "rft";
  if (/^kgs?$/.test(u)) return "KGS";
  if (/^nos?$/.test(u)) return "NOS";
  return unit.toUpperCase();
}

const paymentNoted = (p) => Boolean(p && (p.mode || p.reference || p.date || has(p.amount) || p.note));

const words = (text) => String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
const digits = (text) => String(text ?? "").replace(/\D/g, "");

// A handwritten note that only repeats something already read elsewhere (invoice no., date, buyer,
// a line's description or amount, a GST rate, "P.T.O.") is transcription, not an annotation.
function repeatsInvoice(note, invoice) {
  const text = String(note).trim();
  if (!text) return true;
  if (/^p\.?\s*t\.?\s*o\.?$/i.test(text)) return true;
  const noteDigits = digits(text);
  const noteWords = words(text);
  const amounts = [
    ...(invoice.lineItems ?? []).flatMap((l) => [l.amount, l.taxableValue, l.rate, l.qty]),
    ...Object.values(invoice.totals ?? {}),
  ].filter(has);
  // Just a number, rate or amount ("160/-", "18%", "154624=w") that appears on the invoice.
  if (noteWords.every((w) => /^\d+$/.test(w) || ["w", "rs", "inr", "per", "sqft", "sft", "nos", "kg", "kgs"].includes(w)) && noteDigits) {
    if (amounts.some((a) => digits(Math.round(a)) === noteDigits || digits(a.toFixed(2)) === noteDigits)) return true;
    if (/%$/.test(text)) return true;
  }
  const compact = text.replace(/\s/g, "").toUpperCase();
  if ([invoice.supplier?.gstin, invoice.buyer?.gstin].some((g) => g && compact === g.toUpperCase())) return true;
  if (invoice.invoiceNo && digits(invoice.invoiceNo) && noteDigits === digits(invoice.invoiceNo) && noteWords.length <= 2) return true;
  // The invoice date in another form ("13/8/2026.", "13-08-26").
  const date = /^(\d{1,2})\D(\d{1,2})\D(\d{2,4})\.?$/.exec(text);
  const own = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(invoice.invoiceDate ?? "");
  if (date && own && Number(date[1]) === Number(own[1]) && Number(date[2]) === Number(own[2]) && own[3].endsWith(date[3].slice(-2))) return true;
  // Mostly the same words as the buyer, address, amount in words or a line description.
  const sources = [invoice.buyer?.name, invoice.buyer?.address, invoice.supplier?.name, invoice.totals?.amountInWords, ...(invoice.lineItems ?? []).map((l) => l.description)].filter(Boolean);
  for (const source of sources) {
    const known = new Set(words(source));
    const overlap = noteWords.filter((w) => known.has(w)).length;
    if (noteWords.length && overlap / noteWords.length >= 0.6) return true;
  }
  return false;
}

// options.dictionary: Map(item keyword -> HSN) from hsnDictionary.js.
function applyReadingRules(input, { dictionary = new Map() } = {}) {
  const invoice = structuredClone(input);
  const derived = []; // what was filled in by code, for the review notes
  invoice.confidence ??= {};
  const t = (invoice.totals ??= {});
  const lines = (invoice.lineItems ??= []);

  // One spelling for area/length units ("sq ft", "Sq.Ft", "sft" -> "sqft"); other units stay as written.
  for (const line of lines) {
    if (line.unit && /^(?:sq\.?\s*f(?:ee)?t|sft|sq\.?\s*m(?:tr)?s?|r\.?\s*ft|running\s*ft)$/i.test(line.unit.trim())) line.unit = normalizeUnit(line.unit.trim());
  }

  // A 4-8 digit whole "qty" that does not multiply out to the amount is the HSN/SAC code read into the wrong column.
  lines.forEach((line, i) => {
    if (line.hsnSac || !Number.isInteger(line.qty) || !/^\d{4,8}$/.test(String(line.qty))) return;
    if (has(line.rate) && has(line.amount) && Math.abs(line.qty * line.rate - line.amount) <= 1) return;
    line.hsnSac = String(line.qty);
    line.qty = null;
    derived.push(`Line ${line.sno ?? i + 1}: ${line.hsnSac} is 4+ digits and does not match rate x amount, so it is the HSN, not the quantity.`);
  });

  // HSN still empty. a) from the line's own written text; b) the same item elsewhere on this invoice; c) the item
  // dictionary. Only a) is a direct reading; b) and c) are flagged (line.hsnNote) because the bill does not say it.
  lines.forEach((line, i) => {
    if (line.hsnSac) return;
    const hit = hsnFromRawLine(line, invoice);
    if (!hit) return;
    line.hsnSac = hit.hsn;
    derived.push(`Line ${line.sno ?? i + 1}: HSN ${hit.hsn} read from the line's written text.`);
    if (!has(line.rate)) (line.rate = hit.rate, derived.push(`Line ${line.sno ?? i + 1}: rate ${hit.rate} read from the line's written text.`));
  });
  lines.forEach((line, i) => {
    if (line.hsnSac) return;
    const key = itemKey(line.description);
    if (!key) return;
    const same = lines.find((other) => other !== line && other.hsnSac && itemKey(other.description) === key);
    const fromDictionary = same ? null : dictionary.get(key);
    const hsn = same?.hsnSac ?? fromDictionary;
    if (!hsn) return;
    const where = same ? `line ${same.sno ?? lines.indexOf(same) + 1}` : "the item dictionary";
    line.hsnSac = hsn;
    line.hsnNote = `HSN ${hsn} taken from ${where}, not written on the bill`;
    derived.push(`Line ${line.sno ?? i + 1}: ${line.hsnNote}.`);
  });

  // Line qty/unit written inside the description (no qty column on the form).
  lines.forEach((line, i) => {
    if (has(line.qty) || !line.description) return;
    const matches = [...String(line.description).matchAll(QTY_IN_TEXT)];
    if (matches.length !== 1) return; // none, or ambiguous: leave empty
    line.qty = Number(matches[0][1]);
    line.unit ??= normalizeUnit(matches[0][2]);
    invoice.confidence[`lineItems[${i}].qty`] ??= "medium";
    derived.push(`Line ${line.sno ?? i + 1}: ${/^(sqft|sqm|rft)$/.test(line.unit ?? "") ? "area" : "qty"} ${line.qty} ${line.unit} taken from the description.`);
  });

  // Still no qty: amount / rate.
  lines.forEach((line, i) => {
    if (has(line.qty) || !has(line.rate) || line.rate <= 0 || !has(line.amount)) return;
    line.qty = round2(line.amount / line.rate);
    invoice.confidence[`lineItems[${i}].qty`] ??= "medium";
    derived.push(`Line ${line.sno ?? i + 1}: qty ${line.qty} worked out as amount / rate.`);
  });

  // Taxable amount and CGST/SGST from each other (a missing one only; written values stay).
  const half = (rate) => (has(rate) ? rate : null);
  const taxRate = half(t.cgstRate) ?? half(t.sgstRate);
  if (!has(t.cgst) && has(t.sgst)) (t.cgst = t.sgst, derived.push("CGST taken as equal to SGST."));
  else if (!has(t.sgst) && has(t.cgst)) (t.sgst = t.cgst, derived.push("SGST taken as equal to CGST."));
  const linesSum = lines.every((line) => has(line.amount)) && lines.length ? round2(lines.reduce((sum, line) => sum + line.amount, 0)) : null;
  if (!has(t.taxableAmount) && !has(t.subtotal) && (has(t.cgst) || has(t.igst))) { // only when a tax amount was written
    if (has(t.cgst) && taxRate) (t.taxableAmount = round2((t.cgst * 100) / taxRate), derived.push(`Taxable amount ${t.taxableAmount} worked out from CGST ${t.cgst} at ${taxRate}%.`));
    else if (linesSum !== null) (t.taxableAmount = linesSum, derived.push(`Taxable amount ${linesSum} taken as the sum of the lines.`));
    else if (has(t.grandTotal) && (has(t.cgst) || has(t.igst))) (t.taxableAmount = round2(t.grandTotal - (t.cgst ?? 0) - (t.sgst ?? 0) - (t.igst ?? 0) - (t.roundOff ?? 0)), derived.push(`Taxable amount ${t.taxableAmount} worked out as grand total - taxes.`));
  }
  const taxable0 = has(t.taxableAmount) ? t.taxableAmount : null;
  if (taxable0 && !taxRate && has(t.cgst) && has(t.sgst) && t.cgst === t.sgst) {
    const each = round2((t.cgst / taxable0) * 100);
    const standard = [0.125, 0.5, 1.5, 2.5, 6, 9, 14].find((r) => Math.abs(r - each) <= 0.15);
    if (standard !== undefined) (t.cgstRate = t.sgstRate = standard, derived.push(`GST rate ${standard * 2}% worked out from CGST / taxable amount.`));
  } else if (taxable0 && taxRate && !has(t.cgst) && !has(t.igst)) {
    t.cgst = t.sgst = round2((taxable0 * taxRate) / 100);
    derived.push(`CGST and SGST ${t.cgst} each worked out from the taxable amount at ${taxRate}%.`);
  }

  // Line GST rate from the invoice-level CGST x% + SGST x% (or IGST x%).
  const invoiceRate = has(t.igstRate) && t.igstRate > 0 ? t.igstRate : has(t.cgstRate) && has(t.sgstRate) && t.cgstRate === t.sgstRate ? t.cgstRate + t.sgstRate : null;
  if (invoiceRate !== null && lines.length && lines.every((line) => !has(line.gstRate))) {
    for (const line of lines) line.gstRate = invoiceRate;
    derived.push(`GST ${invoiceRate}% applied to every line, from the invoice's CGST/SGST (or IGST) rate.`);
  }

  // Round-off = grand total - (taxable + taxes), computed here when it is a real round-off (<= 1).
  const taxable = has(t.taxableAmount) ? t.taxableAmount : has(t.subtotal) ? round2(t.subtotal - (has(t.discount) ? t.discount : 0)) : null;
  if (taxable !== null && has(t.grandTotal)) {
    const difference = round2(t.grandTotal - (taxable + (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0)));
    // No round-off (difference 0) stays blank unless one was written.
    if (Math.abs(difference) <= 1 && t.roundOff !== difference && (difference !== 0 || has(t.roundOff))) {
      if (has(t.roundOff)) derived.push(`Round-off read as ${t.roundOff}; ${difference} worked out from the totals is used.`);
      t.roundOff = difference;
    }
  }

  // Handwritten notes: annotations outside the item table only, never a transcription of the invoice.
  const notes = (invoice.handwrittenNotes ?? []).filter((note) => !repeatsInvoice(note, invoice));
  if (notes.length !== (invoice.handwrittenNotes ?? []).length) invoice.handwrittenNotes = notes;
  // Note indexes shift when notes are dropped, and notes are never "please check" fields anyway.
  for (const path of Object.keys(invoice.confidence)) if (path.startsWith("handwrittenNotes")) delete invoice.confidence[path];

  // Payment: the model's paid/unpaid guess is ignored. Blank unless a payment note exists; with an
  // amount, compared with the grand total. A reference is a cheque/UTR/NEFT number, never the amount.
  const p = (invoice.payment ??= {});
  if (p.reference && has(p.amount) && String(p.reference).replace(/\D/g, "") === String(Math.round(p.amount)).replace(/\D/g, "")) {
    p.reference = null;
    derived.push("The payment reference was the amount paid, so it was removed.");
  }
  if (!paymentNoted(p)) p.status = null;
  else if (!has(p.amount) || !has(t.grandTotal)) p.status = "paid";
  else p.status = p.amount >= t.grandTotal - 1 ? "paid" : "partial";

  return { invoice, derived };
}

export { applyReadingRules, hsnFromRawLine, itemKey, normalizeUnit, validHsn };
