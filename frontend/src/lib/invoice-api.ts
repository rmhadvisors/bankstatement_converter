// Invoice / receipt converter API (backend/src/invoice/service.js).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type EntryType = "STOCK" | "NORMAL" | "TCS" | "IMPORT";
export const ENTRY_TYPES: EntryType[] = ["STOCK", "NORMAL", "TCS", "IMPORT"];
export type Party = { name: string; gstin: string | null; entryType: EntryType };

// InvoiceJSON (backend/src/invoice/schema.js); kept loose here, the backend validates it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Invoice = Record<string, any>;
export type Reason = { level: "incomplete" | "review" | "note"; field: string; message: string };
export type InvoiceStatus = "OK" | "NEEDS REVIEW" | "INCOMPLETE";
export type Evaluated = {
  status: InvoiceStatus;
  reasons: Reason[];
  computed: { lines: { written: number | null; computed: number | null; ok: boolean | null }[]; linesSum: number };
  party: { name: string; entryType: EntryType; source: "settings" | "chosen" | "guess"; guessReason?: string };
  invoice: Invoice;
};
export type JobFile = { name: string; state: "queued" | "reading" | "done" | "error"; invoice?: Invoice; error?: { code: string; message: string } };
export type ExportItem = { invoice: Invoice; sourceFile: string; entryType?: EntryType };

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 202) throw new Error(body?.message || `Request failed (${response.status})`);
  return body as T;
}

export async function getInvoiceConfig(): Promise<{ mode: "demo" | "live"; defaultParties: Party[] }> {
  return jsonOrThrow(await fetch(`${API_BASE_URL}/api/invoice/config`));
}

// Uploads the batch, then polls until every file is read; onProgress gets the per-file states.
export async function convertInvoices(files: File[], onProgress: (files: JobFile[], mode: string) => void): Promise<JobFile[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const { jobId } = await jsonOrThrow<{ jobId: string }>(await fetch(`${API_BASE_URL}/api/invoice/convert`, { method: "POST", body: form }));
  for (;;) {
    const response = await fetch(`${API_BASE_URL}/api/invoice/convert/${jobId}`);
    const body = await jsonOrThrow<{ status: string; mode: string; files: JobFile[] }>(response);
    onProgress(body.files, body.mode);
    if (body.status === "done") return body.files;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

export async function validateInvoices(items: ExportItem[], parties: Party[], financialYear: string): Promise<Evaluated[]> {
  const response = await fetch(`${API_BASE_URL}/api/invoice/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, parties, financialYear }),
  });
  return (await jsonOrThrow<{ results: Evaluated[] }>(response)).results;
}

export async function exportInvoices(items: ExportItem[], parties: Party[], financialYear: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/invoice/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, parties, financialYear }),
  });
  if (!response.ok) await jsonOrThrow(response);
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: "Invoices_Tally.xlsx" });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
