// InvoiceJSON shape. Leaves are typeof names ("a|b" = either); every leaf may be null/missing.
// Unknown keys are dropped; missing keys become null / [] so later code never checks for undefined.
const oneOf = (...values) => ({ oneOf: values });
const str = "string";
const num = "number";

const INVOICE_SCHEMA = {
  documentType: oneOf("tax_invoice", "bill_of_supply", "receipt", "cash_memo", "other"),
  supplier: { name: str, gstin: str, address: str, phone: str, email: str },
  buyer: { name: str, gstin: str, address: str, state: str, stateCode: str },
  invoiceNo: str,
  invoiceDate: str,
  challanNo: str,
  placeOfSupply: str,
  reverseCharge: "boolean",
  lineItems: [
    {
      sno: "string|number", description: str, hsnSac: str, qty: num, unit: str, rate: num, discount: num,
      taxableValue: num, gstRate: num, cgst: num, sgst: num, igst: num, amount: num,
    },
  ],
  totals: {
    subtotal: num, discount: num, taxableAmount: num, cgstRate: num, cgst: num, sgstRate: num, sgst: num,
    igstRate: num, igst: num, roundOff: num, grandTotal: num, amountInWords: str, tcs: num,
  },
  payment: { status: oneOf("paid", "unpaid", "partial"), mode: str, reference: str, date: str, amount: num, note: str },
  bankDetails: { bank: str, accountNo: str, ifsc: str, branch: str },
  handwrittenNotes: [str],
  continuedOverleaf: "boolean",
  confidence: { "*": oneOf("high", "medium", "low") },
  unreadable: [{ field: str, reason: str }],
};

function check(schema, value, path, errors) {
  if (typeof schema === "string" || schema.oneOf) {
    if (value === undefined || value === null) return null;
    const ok = schema.oneOf
      ? schema.oneOf.includes(value)
      : schema.split("|").includes(typeof value) && (typeof value !== "number" || Number.isFinite(value));
    if (!ok) errors.push(`${path}: expected ${schema.oneOf ? schema.oneOf.join("|") : schema}, got ${JSON.stringify(value)}`);
    return value;
  }
  if (Array.isArray(schema)) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected an array`);
      return [];
    }
    return value.map((item, i) => check(schema[0], item, `${path}[${i}]`, errors));
  }
  if (value === undefined || value === null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path || "invoice"}: expected an object`);
    value = {};
  }
  const join = (k) => (path ? `${path}.${k}` : k);
  if (schema["*"]) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, check(schema["*"], v, join(k), errors)]));
  }
  return Object.fromEntries(Object.keys(schema).map((k) => [k, check(schema[k], value[k], join(k), errors)]));
}

// -> { ok, errors, invoice } where invoice is the normalized copy.
function validateInvoiceJson(raw) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) errors.push("invoice: expected an object");
  const invoice = check(INVOICE_SCHEMA, raw, "", errors);
  return { ok: errors.length === 0, errors, invoice };
}

export { INVOICE_SCHEMA, validateInvoiceJson };
