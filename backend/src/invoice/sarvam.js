// Sarvam Document Intelligence "Extract" (REST, job-based): submit file + JSON schema -> job_id ->
// poll status -> results with per-field confidence. Mapped into InvoiceJSON here; the caller runs
// the same schema check and validation as for Claude. Nothing here logs invoice contents.
// API: https://docs.sarvam.ai/api-reference/doc-ai/job/extract (+ /status, /results)
import { INVOICE_SCHEMA } from "./schema.js";

const BASE_URL = "https://api.sarvam.ai/doc-ai/v1/job";
const TIMEOUT_MS = Number(process.env.SARVAM_TIMEOUT_MS) || 300_000;
// ponytail: Sarvam allows 10 requests/minute per key, polls included, so jobs run one at a time and
// poll every 7 s. Raise both only if Sarvam raises the limit for the account.
const POLL_MS = 7_000;
const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);

const sarvamError = (code, message) => Object.assign(new Error(message), { code });

// Every field needs a non-empty description (Sarvam requirement). Same rules as the Claude prompt.
const DESCRIPTIONS = {
  documentType: "Kind of document: tax_invoice if it says Tax Invoice, else bill_of_supply, receipt, cash_memo or other",
  supplier: "The business that issued the invoice (letterhead / From)",
  buyer: "The party billed to",
  name: "Name exactly as written",
  gstin: "15-character GSTIN exactly as printed, upper case; do not correct it",
  address: "Address as written",
  phone: "Phone number as written",
  email: "Email as written",
  state: "State name as written",
  stateCode: "2-digit state code as written",
  invoiceNo: "Invoice / bill number exactly as written",
  invoiceDate: "Invoice date as dd/mm/yyyy",
  challanNo: "Delivery challan number if printed",
  placeOfSupply: "Place of supply as written, e.g. 27-MAHARASHTRA",
  reverseCharge: "true if reverse charge is marked Yes",
  lineItems: "One entry per printed item row, values copied as written, never calculated",
  sno: "Serial number of the row",
  description: "Item or work description as written",
  hsnSac: "HSN or SAC code exactly as written",
  qty: "Quantity or area as a number. If there is no quantity column, take the quantity or area written inside the description (\"total area 337 sq ft\" -> 337); empty if none is written",
  unit: "Unit of the quantity as written (KGS, sqft, Nos); if the quantity comes from the description, the unit written next to it",
  rate: "Rate per unit as a number",
  discount: "Discount amount on the row as a number",
  taxableValue: "Taxable value column of the row, only if the invoice has that column",
  gstRate: "Total GST percent of the row (CGST 9% + SGST 9% = 18)",
  cgst: "CGST amount as written",
  sgst: "SGST amount as written",
  igst: "IGST amount as written",
  amount: "Row amount as written (even if qty x rate differs)",
  totals: "The totals block as written; leave values empty if the totals area is blank",
  subtotal: "Sub total as written",
  taxableAmount: "Total taxable amount as written",
  cgstRate: "CGST percent as written",
  sgstRate: "SGST percent as written",
  igstRate: "IGST percent as written",
  roundOff: "Round off amount as written (negative if subtracted)",
  grandTotal: "Grand total as written",
  amountInWords: "Amount in words exactly as written, including handwritten words next to \"In Words\"",
  tcs: "TCS amount as written",
  payment: "Payment details from printed or handwritten notes",
  status: "Leave empty (computed by the accountant from the amount)",
  mode: "Payment mode as written (cash, cheque, NEFT, UPI)",
  reference: "Cheque, UTR or NEFT reference number copied digit by digit exactly as written (keep leading zeros). Never the amount",
  date: "Payment date as dd/mm/yyyy",
  note: "Payment note as written",
  bankDetails: "Supplier bank details printed on the invoice",
  bank: "Bank name",
  accountNo: "Account number",
  ifsc: "IFSC code",
  branch: "Branch",
  handwrittenNotes: "Every handwritten annotation on this invoice sheet that is not part of the printed form, verbatim; ignore text on other papers at the photo edges",
  continuedOverleaf: "true only if THIS invoice sheet says P.T.O. / continued, or its totals are on a page not included. Ignore P.T.O. or any text printed on other papers visible at the edges of the photo",
};

// InvoiceJSON schema -> Sarvam JSON schema (no confidence/unreadable: Sarvam returns its own).
function toSarvamSchema(schema, key = "invoice") {
  const description = DESCRIPTIONS[key] ?? key;
  if (typeof schema === "string") {
    const type = schema.split("|").includes("number") ? "number" : schema.split("|")[0];
    return { type, description };
  }
  if (schema.oneOf) return { type: "string", enum: schema.oneOf, description };
  if (Array.isArray(schema)) return { type: "array", description, items: toSarvamSchema(schema[0], "item") };
  const properties = Object.fromEntries(
    Object.entries(schema)
      .filter(([k]) => !["confidence", "unreadable", "derived"].includes(k))
      .map(([k, v]) => [k, toSarvamSchema(v, k)]),
  );
  return { type: "object", description: key === "item" ? "Line item row" : description, properties };
}
const SARVAM_SCHEMA = JSON.stringify({ ...toSarvamSchema(INVOICE_SCHEMA), description: "One Indian GST invoice or receipt transcribed exactly as written. Read only the main invoice sheet; ignore any other papers or text visible at the edges of the photo" });

// Values -> InvoiceJSON types: "" -> null; an Indian-format numeric string -> number (only when the
// whole string is a number, e.g. "1,54,624.00"); anything else is left for the schema check to reject.
function coerce(schema, value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof schema === "string" && schema.includes("number") && typeof value === "string") {
    const cleaned = value.replace(/[,\s₹]|Rs\.?|\/-$/gi, "");
    return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : value;
  }
  if (schema === "string" && typeof value === "number") return String(value);
  if (typeof schema === "string" && schema === "boolean" && typeof value === "string") return /^(true|yes)$/i.test(value) ? true : /^(false|no)$/i.test(value) ? false : value;
  if (Array.isArray(schema)) return Array.isArray(value) ? value.map((item) => coerce(schema[0], item)) : value;
  if (typeof schema === "object" && !schema.oneOf && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schema[k] ? coerce(schema[k], v) : v]));
  }
  return value;
}

// annotations mirror result; each leaf { confidence: 0..1, sources }. -> { "lineItems[0].hsnSac": "low" }
function confidenceMap(annotations, prefix = "", out = {}) {
  if (!annotations || typeof annotations !== "object") return out;
  if (typeof annotations.confidence === "number" && !Array.isArray(annotations)) {
    const c = annotations.confidence > 1 ? annotations.confidence / 100 : annotations.confidence;
    if (prefix && c < 0.6) out[prefix] = "low";
    else if (prefix && c < 0.85) out[prefix] = "medium";
    return out;
  }
  for (const [key, value] of Object.entries(annotations)) {
    const path = Array.isArray(annotations) ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : key;
    confidenceMap(value, path, out);
  }
  return out;
}

function sarvamProvider({ apiKey = process.env.SARVAM_API_KEY, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = POLL_MS } = {}) {
  const call = async (path, init = {}, attempt = 0) => {
    const response = await fetchImpl(`${BASE_URL}${path}`, { ...init, headers: { "api-subscription-key": apiKey, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    if (response.status === 429 && attempt < 3) {
      await sleep((Number(response.headers.get("retry-after")) || 15) * 1000);
      return call(path, init, attempt + 1);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw sarvamError("SARVAM_FAILED", `Sarvam error ${response.status}: ${body?.detail ?? body?.title ?? response.statusText}`);
    return body;
  };

  return {
    name: "sarvam",
    // upload: { name, buffer, mediaType } -> { invoice (unvalidated), confidence, pages }
    async extract(upload) {
      if (!apiKey) throw sarvamError("SARVAM_KEY_MISSING", "Sarvam is not configured (SARVAM_API_KEY is not set).");
      const form = new FormData();
      form.append("file", new Blob([upload.buffer], { type: upload.mediaType }), upload.name);
      form.append("schema", SARVAM_SCHEMA);
      form.append("output_format", "json");
      const { job_id: jobId } = await call("/extract", { method: "POST", body: form });

      const deadline = Date.now() + TIMEOUT_MS;
      let status;
      do {
        if (Date.now() > deadline) throw sarvamError("SARVAM_TIMEOUT", `Sarvam did not finish within ${Math.round(TIMEOUT_MS / 1000)} s.`);
        await sleep(pollMs);
        status = await call(`/${jobId}/status`);
      } while (!TERMINAL.has(status.status));
      if (status.status === "failed" || status.status === "rejected") throw sarvamError("SARVAM_JOB_FAILED", `Sarvam job ${status.status}.`);

      const results = await call(`/${jobId}/results?format=json`);
      return {
        invoice: { ...coerce(INVOICE_SCHEMA, results.result ?? {}), confidence: confidenceMap(results.annotations) },
        pages: results.usage?.pages_total ?? status.usage?.pages_total ?? null,
        partial: status.status === "partially_completed",
      };
    },
  };
}

export { coerce, confidenceMap, SARVAM_SCHEMA, sarvamProvider, toSarvamSchema };
