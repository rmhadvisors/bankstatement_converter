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
    derived.push(`Line ${line.sno ?? i + 1}: qty ${line.qty} ${line.unit} taken from the description`);
  });

  // Line GST rate from the invoice-level CGST x% + SGST x% (or IGST x%).
  const invoiceRate = has(t.igstRate) && t.igstRate > 0 ? t.igstRate : has(t.cgstRate) && has(t.sgstRate) && t.cgstRate === t.sgstRate ? t.cgstRate + t.sgstRate : null;
  if (invoiceRate !== null && lines.length && lines.every((line) => !has(line.gstRate))) {
    for (const line of lines) line.gstRate = invoiceRate;
    derived.push(`GST ${invoiceRate}% applied to all lines from the invoice's tax rates`);
  }

  // Round-off = grand total - (taxable + taxes), computed here when it is a real round-off (<= 1).
  const taxable = has(t.taxableAmount) ? t.taxableAmount : has(t.subtotal) ? round2(t.subtotal - (has(t.discount) ? t.discount : 0)) : null;
  if (taxable !== null && has(t.grandTotal)) {
    const difference = round2(t.grandTotal - (taxable + (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0)));
    // No round-off (difference 0) stays blank unless one was written.
    if (Math.abs(difference) <= 1 && t.roundOff !== difference && (difference !== 0 || has(t.roundOff))) {
      if (has(t.roundOff)) derived.push(`Round-off ${t.roundOff} read; ${difference} computed from the totals`);
      t.roundOff = difference;
    }
  }

  // Payment: the model's paid/unpaid guess is ignored. Blank unless a payment note exists; with an
  // amount, compared with the grand total. A reference is a cheque/UTR/NEFT number, never the amount.
  const p = (invoice.payment ??= {});
  if (p.reference && has(p.amount) && String(p.reference).replace(/\D/g, "") === String(Math.round(p.amount)).replace(/\D/g, "")) {
    p.reference = null;
    derived.push("Payment reference was the amount; cleared");
  }
  if (!paymentNoted(p)) p.status = null;
  else if (!has(p.amount) || !has(t.grandTotal)) p.status = "paid";
  else p.status = p.amount >= t.grandTotal - 1 ? "paid" : "partial";

  return { invoice, derived };
}

export { applyReadingRules, normalizeUnit };
