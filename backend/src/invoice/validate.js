// Recomputes every invoice figure in code. Written values are never changed: a mismatch is reported
// with both the written and the computed value, and the invoice gets a status:
//   INCOMPLETE   totals missing or continued overleaf (P.T.O.) -- not an error
//   NEEDS REVIEW any arithmetic/GSTIN/date/duplicate problem
//   OK           nothing above; "note" reasons (low confidence, payment difference) don't change it
import { cleanGstin, gstinProblem, gstinStateCode } from "./gstin.js";
import { amountToIndianWords, wordsToAmount } from "./amountWords.js";

const LINE_TOLERANCE = 1;
const TAX_TOLERANCE = 1;
const ROUND_OFF_LIMIT = 1;

const has = (n) => typeof n === "number" && Number.isFinite(n);
const round2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const sum = (values) => round2(values.reduce((a, b) => a + b, 0));
const fmt = (n) =>
  n.toLocaleString("en-IN", Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseDmy(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const date = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return date.getUTCDate() === +m[1] && date.getUTCMonth() === +m[2] - 1 ? date : null;
}

// "2026-27" -> 01/04/2026 .. 31/03/2027
function financialYearRange(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(fy ?? "");
  return m ? [Date.UTC(+m[1], 3, 1), Date.UTC(+m[1] + 1, 2, 31)] : null;
}

const leadingStateCode = (text) => /^\s*(\d{2})(?!\d)/.exec(text ?? "")?.[1] ?? null;

// Written line value: taxable value if the invoice has that column, else the amount column.
const lineValue = (line) => (has(line.taxableValue) ? line.taxableValue : has(line.amount) ? line.amount : null);

const FIELD_LABELS = {
  hsnSac: "HSN/SAC", qty: "qty", rate: "rate", amount: "amount", taxableValue: "taxable value", gstRate: "GST rate",
  description: "description", unit: "unit", gstin: "GSTIN", name: "name", grandTotal: "grand total",
  taxableAmount: "taxable amount", amountInWords: "amount in words", invoiceNo: "invoice no.", invoiceDate: "invoice date",
};
// "lineItems[0].hsnSac" -> "line 1 HSN/SAC", "supplier.gstin" -> "supplier GSTIN"
function fieldLabel(path) {
  const line = /^lineItems\[(\d+)\]\.(\w+)$/.exec(path);
  if (line) return `line ${Number(line[1]) + 1} ${FIELD_LABELS[line[2]] ?? line[2]}`;
  return path
    .split(".")
    .map((part) => FIELD_LABELS[part] ?? part)
    .join(" ");
}

function getPath(obj, path) {
  return path.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function validateInvoice(invoice, { financialYear = null, today = new Date() } = {}) {
  const reasons = [];
  const add = (level, field, message) => reasons.push({ level, field, message });
  const t = invoice.totals ?? {};
  const lines = invoice.lineItems ?? [];

  // Key fields
  if (!invoice.supplier?.name) add("review", "supplier.name", "Supplier name missing");
  if (!invoice.invoiceNo) add("review", "invoiceNo", "Invoice number missing");
  if (invoice.documentType === "tax_invoice" && !invoice.supplier?.gstin) {
    add("review", "supplier.gstin", "Supplier GSTIN missing on a tax invoice");
  }

  // GSTINs
  for (const [who, field] of [["Supplier", "supplier.gstin"], ["Buyer", "buyer.gstin"]]) {
    const value = getPath(invoice, field);
    const problem = value ? gstinProblem(value) : null;
    if (problem) add("review", field, `${who} GSTIN ${cleanGstin(value)}: ${problem} -- possible misread`);
  }

  // Dates
  const date = parseDmy(invoice.invoiceDate);
  if (!invoice.invoiceDate) add("review", "invoiceDate", "Invoice date missing");
  else if (!date) add("review", "invoiceDate", `Invoice date "${invoice.invoiceDate}" is not a valid dd/mm/yyyy date`);
  else {
    if (date.getTime() > today.getTime()) add("review", "invoiceDate", `Invoice date ${invoice.invoiceDate} is in the future`);
    const fy = financialYearRange(financialYear);
    if (fy && (date.getTime() < fy[0] || date.getTime() > fy[1])) {
      add("review", "invoiceDate", `Invoice date ${invoice.invoiceDate} is outside FY ${financialYear}`);
    }
  }
  const paymentDate = invoice.payment?.date ? parseDmy(invoice.payment.date) : null;
  if (invoice.payment?.date && !paymentDate) {
    add("review", "payment.date", `Payment date "${invoice.payment.date}" is not a valid dd/mm/yyyy date`);
  } else if (paymentDate && paymentDate.getTime() > today.getTime()) {
    add("review", "payment.date", `Payment date ${invoice.payment.date} is in the future`);
  }

  // Lines: qty x rate (- discount) vs the written value
  const lineChecks = lines.map((line, i) => {
    const label = `Line ${line.sno ?? i + 1}${line.description ? ` (${line.description})` : ""}`;
    const field = `lineItems[${i}]`;
    const written = lineValue(line);
    const computed = has(line.qty) && has(line.rate) ? round2(line.qty * line.rate - (has(line.discount) ? line.discount : 0)) : null;
    let ok = null;
    if (written === null) {
      add("review", `${field}.amount`, computed === null ? `${label}: amount unreadable` : `${label}: amount missing (computed ${fmt(computed)})`);
    } else if (computed !== null) {
      ok = Math.abs(written - computed) <= LINE_TOLERANCE;
      if (!ok) add("review", `${field}.amount`, `${label}: ${fmt(written)} written vs ${fmt(computed)} computed (qty x rate)`);
    }
    return { written, computed, ok };
  });
  const linesSum = sum(lineChecks.map((c) => c.written ?? 0));

  // Taxable base
  const taxable = has(t.taxableAmount) ? t.taxableAmount : has(t.subtotal) ? round2(t.subtotal - (has(t.discount) ? t.discount : 0)) : null;
  const linesCompareTo = has(t.subtotal) ? ["subtotal", t.subtotal] : has(t.taxableAmount) ? ["taxable amount", t.taxableAmount] : null;
  if (lines.length && linesCompareTo && Math.abs(linesSum - linesCompareTo[1]) > LINE_TOLERANCE) {
    add("review", "totals.taxableAmount", `Sum of lines ${fmt(linesSum)} vs ${linesCompareTo[0]} ${fmt(linesCompareTo[1])}`);
  }

  // Incomplete: P.T.O. or missing totals
  if (invoice.continuedOverleaf) add("incomplete", "continuedOverleaf", "Continued overleaf (P.T.O.) -- next page not included");
  if (taxable === null && !has(t.grandTotal)) {
    add("incomplete", "totals", `Totals section blank; sum of lines ${fmt(linesSum)} (computed only)`);
  } else if (!has(t.grandTotal)) {
    add("incomplete", "totals.grandTotal", "Grand total not written");
  }

  // Intra- vs inter-state: supplier state vs place of supply (else buyer state / GSTIN), else what was charged.
  const supplierState = gstinStateCode(invoice.supplier?.gstin);
  const destinationState =
    leadingStateCode(invoice.placeOfSupply) ?? leadingStateCode(invoice.buyer?.stateCode) ?? gstinStateCode(invoice.buyer?.gstin);
  const charged = (n) => has(n) && n !== 0;
  let intraState = supplierState && destinationState ? supplierState === destinationState : null;
  if (intraState === true && charged(t.igst)) {
    add("review", "totals.igst", `IGST charged, but supplier and place of supply are both state ${supplierState} (expected CGST + SGST)`);
  } else if (intraState === false && (charged(t.cgst) || charged(t.sgst))) {
    add("review", "totals.cgst", `CGST/SGST charged, but supplier state ${supplierState} differs from place of supply ${destinationState} (expected IGST)`);
  }
  if (intraState === null) intraState = charged(t.igst) ? false : charged(t.cgst) || charged(t.sgst) ? true : null;

  // Expected tax per GST rate. Line rate first, else the rate written in the totals block.
  const totalsRate = has(t.igstRate) ? t.igstRate : has(t.cgstRate) ? t.cgstRate * 2 : null;
  const rateOf = (line) => (has(line.gstRate) ? line.gstRate : totalsRate);
  const byLine = lines.length > 0 && lines.every((line, i) => lineChecks[i].written !== null && rateOf(line) !== null);
  const groups = new Map();
  if (byLine) lines.forEach((line, i) => groups.set(rateOf(line), round2((groups.get(rateOf(line)) ?? 0) + lineChecks[i].written)));
  else if (taxable !== null && totalsRate !== null) groups.set(totalsRate, taxable);
  const rateGroups = [...groups].map(([rate, base]) => {
    const tax = round2((base * rate) / 100);
    return intraState === false
      ? { rate, taxable: base, cgst: 0, sgst: 0, igst: tax }
      : { rate, taxable: base, cgst: round2(tax / 2), sgst: round2(tax / 2), igst: 0 };
  });
  const expected = rateGroups.length
    ? { cgst: sum(rateGroups.map((g) => g.cgst)), sgst: sum(rateGroups.map((g) => g.sgst)), igst: sum(rateGroups.map((g) => g.igst)) }
    : null;

  if (has(t.cgstRate) && has(t.sgstRate) && t.cgstRate !== t.sgstRate) {
    add("review", "totals.sgstRate", `CGST rate ${t.cgstRate}% and SGST rate ${t.sgstRate}% differ`);
  }
  if (taxable !== null && expected) {
    for (const key of intraState === false ? ["igst"] : ["cgst", "sgst"]) {
      const name = key.toUpperCase();
      if (!has(t[key])) add("review", `totals.${key}`, `${name} not written (computed ${fmt(expected[key])})`);
      else if (Math.abs(t[key] - expected[key]) > TAX_TOLERANCE) {
        add("review", `totals.${key}`, `${name}: ${fmt(t[key])} written vs ${fmt(expected[key])} computed`);
      }
    }
  } else if (taxable !== null && (charged(t.cgst) || charged(t.sgst) || charged(t.igst))) {
    add("review", "totals.cgstRate", "GST rate not written; tax amounts can't be checked");
  }

  // Grand total = taxable + taxes +/- round-off
  let roundOff = has(t.roundOff) ? t.roundOff : null;
  if (taxable !== null && has(t.grandTotal)) {
    const beforeRounding = sum([taxable, t.cgst ?? 0, t.sgst ?? 0, t.igst ?? 0]);
    const difference = round2(t.grandTotal - beforeRounding);
    if (has(t.roundOff)) {
      if (Math.abs(t.roundOff) > ROUND_OFF_LIMIT) add("review", "totals.roundOff", `Round-off ${fmt(t.roundOff)} is more than ±${ROUND_OFF_LIMIT}`);
      if (Math.abs(difference - t.roundOff) > 0.01) {
        add("review", "totals.grandTotal", `Grand total ${fmt(t.grandTotal)} vs taxable + taxes + round-off ${fmt(round2(beforeRounding + t.roundOff))}`);
      }
    } else if (Math.abs(difference) > ROUND_OFF_LIMIT) {
      add("review", "totals.grandTotal", `Grand total ${fmt(t.grandTotal)} vs taxable + taxes ${fmt(beforeRounding)} (difference ${fmt(difference)})`);
    } else {
      roundOff = difference;
    }
  }

  // Amount in words
  if (t.amountInWords && has(t.grandTotal)) {
    const parsed = wordsToAmount(t.amountInWords);
    if (parsed === null) add("note", "totals.amountInWords", `Amount in words couldn't be read as a number: "${t.amountInWords}"`);
    else if (Math.abs(parsed - t.grandTotal) > 0.005) {
      add("review", "totals.amountInWords", `Amount in words says ${fmt(parsed)}, grand total is ${fmt(t.grandTotal)} ("${amountToIndianWords(t.grandTotal)}")`);
    }
  }

  // Payment vs grand total (TDS is not assumed; the difference is just shown)
  let payment = { status: invoice.payment?.status ?? null, shortBy: null };
  if (has(invoice.payment?.amount) && has(t.grandTotal)) {
    const short = round2(t.grandTotal - invoice.payment.amount);
    if (short > LINE_TOLERANCE) {
      payment = { status: "partial", shortBy: short };
      add("note", "payment.amount", `Payment received ${fmt(invoice.payment.amount)}, ${fmt(short)} less than grand total`);
    } else if (short < -LINE_TOLERANCE) {
      payment = { status: "paid", shortBy: short };
      add("note", "payment.amount", `Payment received ${fmt(invoice.payment.amount)}, ${fmt(-short)} more than grand total`);
    } else payment = { status: "paid", shortBy: 0 };
  }

  // Model-reported doubts
  for (const [field, level] of Object.entries(invoice.confidence ?? {})) {
    if (level !== "low") continue;
    const value = getPath(invoice, field);
    add("note", field, `Verify ${fieldLabel(field)}${value != null ? `: read as "${value}"` : ""} (low confidence)`);
  }
  for (const { field, reason } of invoice.unreadable ?? []) add("note", field ?? "", `Unreadable ${field ?? "value"}: ${reason ?? "no reason given"}`);

  const status = reasons.some((r) => r.level === "incomplete")
    ? "INCOMPLETE"
    : reasons.some((r) => r.level === "review")
      ? "NEEDS REVIEW"
      : "OK";
  return {
    status,
    reasons,
    computed: {
      lines: lineChecks,
      linesSum,
      taxable,
      intraState,
      rateGroups,
      expectedTax: expected,
      roundOff,
      amountInWords: has(t.grandTotal) ? amountToIndianWords(t.grandTotal) : null,
      payment,
    },
  };
}

const normalizeInvoiceNo = (no) => String(no ?? "").toUpperCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
const supplierKey = (supplier) =>
  supplier?.gstin ? cleanGstin(supplier.gstin) : String(supplier?.name ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

// items: [{ invoice, sourceFile? }]; history: [{ supplierGstin?, supplierName?, invoiceNo, invoiceDate? }]
function validateBatch(items, { history = [], ...options } = {}) {
  const seen = new Map();
  for (const h of history) {
    const key = `${supplierKey({ gstin: h.supplierGstin, name: h.supplierName })}|${normalizeInvoiceNo(h.invoiceNo)}`;
    seen.set(key, `history${h.invoiceDate ? ` (${h.invoiceDate})` : ""}`);
  }
  return items.map(({ invoice, sourceFile }, i) => {
    const result = validateInvoice(invoice, options);
    const key = `${supplierKey(invoice.supplier)}|${normalizeInvoiceNo(invoice.invoiceNo)}`;
    if (invoice.invoiceNo && supplierKey(invoice.supplier)) {
      if (seen.has(key)) {
        result.reasons.push({ level: "review", field: "invoiceNo", message: `Duplicate: same supplier and invoice no. as ${seen.get(key)}` });
        if (result.status === "OK") result.status = "NEEDS REVIEW";
      } else seen.set(key, `${sourceFile ?? `invoice ${i + 1}`} in this batch`);
    }
    return result;
  });
}

export { validateInvoice, validateBatch, parseDmy, financialYearRange };
