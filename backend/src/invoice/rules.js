// Deterministic clean-up of an AI reading (Sarvam or Claude), before validation. These replace
// model guesses with values derived in code from what was read; written amounts are never changed.
const has = (n) => typeof n === "number" && Number.isFinite(n);
const round2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;

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

function applyReadingRules(input) {
  const invoice = structuredClone(input);
  const derived = []; // what was filled in by code, for the review notes
  invoice.confidence ??= {};
  const t = (invoice.totals ??= {});
  const lines = (invoice.lineItems ??= []);

  // One spelling for area/length units ("sq ft", "Sq.Ft", "sft" -> "sqft"); other units stay as written.
  for (const line of lines) {
    if (line.unit && /^(?:sq\.?\s*f(?:ee)?t|sft|sq\.?\s*m(?:tr)?s?|r\.?\s*ft|running\s*ft)$/i.test(line.unit.trim())) line.unit = normalizeUnit(line.unit.trim());
  }

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

export { applyReadingRules, normalizeUnit };
