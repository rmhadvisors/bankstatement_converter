import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Info, Loader2, Plus, RotateCw, Settings, Trash2, UploadCloud, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ConverterTabs } from "@/components/converter-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  convertInvoices,
  ENTRY_TYPES,
  exportInvoices,
  getInvoiceConfig,
  validateInvoices,
  type EntryType,
  type Evaluated,
  type Invoice,
  type JobFile,
  type Party,
} from "@/lib/invoice-api";
import { loadParties, saveParty, type PartyStore } from "@/lib/invoice-parties";

export const Route = createFileRoute("/invoice")({
  head: () => ({
    meta: [
      { title: "Invoices / Receipts - RMH Advisors PDF Converter" },
      { name: "description", content: "Convert invoice and receipt photos and PDFs to a Tally Excel workbook." },
    ],
  }),
  component: InvoicePage,
});

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*";
const MAX_BYTES = 20 * 1024 * 1024;

type Item = {
  id: string;
  file: File;
  previewUrl: string;
  rotation: number;
  state: JobFile["state"] | "pending";
  error?: string;
  invoice?: Invoice;
  evaluated?: Evaluated;
  entryType?: EntryType;
};

// Indian financial year of a date: Apr-Mar.
function currentFinancialYear(now = new Date()) {
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function statusBadge(status?: Evaluated["status"]) {
  if (!status) return null;
  const style = {
    OK: "text-emerald-700 bg-emerald-50",
    "NEEDS REVIEW": "text-amber-800 bg-amber-100",
    INCOMPLETE: "text-sky-800 bg-sky-100",
  }[status];
  const Icon = status === "OK" ? CheckCircle2 : status === "INCOMPLETE" ? Info : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function setPath(invoice: Invoice, path: string, value: unknown): Invoice {
  const next = structuredClone(invoice);
  const keys = path.split(/[.[\]]+/).filter(Boolean);
  let target = next;
  for (const key of keys.slice(0, -1)) target = target[key] ??= /^\d+$/.test(key) ? [] : {};
  target[keys.at(-1)!] = value;
  return next;
}

function getPath(invoice: Invoice | undefined, path: string) {
  return path.split(/[.[\]]+/).filter(Boolean).reduce((o: Invoice | undefined, k) => (o == null ? undefined : o[k]), invoice);
}

function InvoicePage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"demo" | "live" | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [partyStore, setPartyStore] = useState<PartyStore>("browser");
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Latest list for async work (polling, debounced checks) without side effects inside setState.
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    if (!loading && !user) nav({ to: "/" });
  }, [loading, user, nav]);

  useEffect(() => {
    getInvoiceConfig().then((config) => setMode(config.mode), () => setMode(null));
  }, []);

  useEffect(() => {
    if (user) loadParties(user.id).then(({ parties: list, store }) => (setParties(list), setPartyStore(store)));
  }, [user]);

  useEffect(() => () => items.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-validate every read invoice together (duplicates are checked across the batch).
  const revalidate = useCallback(
    async (list: Item[], partyList = parties) => {
      const ready = list.filter((item) => item.invoice);
      if (!ready.length) return;
      try {
        const results = await validateInvoices(
          ready.map((item) => ({ invoice: item.invoice!, sourceFile: item.file.name, entryType: item.entryType })),
          partyList,
          financialYear,
        );
        const byId = new Map(ready.map((item, i) => [item.id, results[i]]));
        setItems((current) => current.map((item) => (byId.has(item.id) ? { ...item, evaluated: byId.get(item.id) } : item)));
      } catch (error) {
        toast.error(`Checks failed: ${error instanceof Error ? error.message : error}`);
      }
    },
    [parties, financialYear],
  );

  useEffect(() => {
    revalidate(items);
  }, [financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((file) => {
      if (file.size > MAX_BYTES) toast.error(`${file.name} is larger than 20 MB`);
      return file.size <= MAX_BYTES;
    });
    setItems((current) => [
      ...current,
      ...picked.map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), rotation: 0, state: "pending" as const })),
    ]);
  }

  async function readAll() {
    const pending = items.filter((item) => item.state === "pending" || item.state === "error");
    if (!pending.length) return;
    setBusy(true);
    try {
      const files = await convertInvoices(
        pending.map((item) => item.file),
        (states, jobMode) => {
          setMode(jobMode as "demo" | "live");
          setItems((current) =>
            current.map((item) => {
              const index = pending.findIndex((p) => p.id === item.id);
              if (index < 0) return item;
              const state = states[index];
              return { ...item, state: state.state, error: state.error?.message, invoice: state.invoice ?? item.invoice };
            }),
          );
        },
      );
      const next = itemsRef.current.map((item) => {
        const index = pending.findIndex((p) => p.id === item.id);
        return index >= 0 && files[index].invoice ? { ...item, invoice: files[index].invoice, state: "done" as const } : item;
      });
      setItems(next);
      await revalidate(next);
      const failed = files.filter((file) => file.state === "error").length;
      if (failed) toast.warning(`${failed} file(s) could not be read.`);
      const firstRead = pending.find((p, i) => files[i].invoice);
      setSelectedId((current) => current ?? firstRead?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  // Edits re-run every check (debounced): the written value is what's validated and exported.
  function edit(id: string, path: string, value: unknown) {
    const next = itemsRef.current.map((item) => (item.id === id && item.invoice ? { ...item, invoice: setPath(item.invoice, path, value) } : item));
    itemsRef.current = next;
    setItems(next);
    clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(() => revalidate(itemsRef.current), 400);
  }

  async function chooseEntryType(item: Item, entryType: EntryType) {
    const name = item.evaluated?.party.name || String(item.invoice?.supplier?.name ?? "").toUpperCase();
    if (!user || !name) return;
    try {
      const next = await saveParty(user.id, partyStore, parties, { name, gstin: item.invoice?.supplier?.gstin ?? null, entryType });
      setParties(next);
      toast.success(`${name} saved as ${entryType}`);
      await revalidate(items, next);
    } catch (error) {
      toast.error(`Could not save the party: ${error instanceof Error ? error.message : error}`);
    }
  }

  async function exportAll() {
    const ready = items.filter((item) => item.invoice);
    const unknown = ready.filter((item) => item.evaluated?.party.source === "guess");
    if (unknown.length) {
      toast.error(`Choose the Tally entry type for ${unknown.map((u) => u.evaluated!.party.name).join(", ")} first.`);
      setSelectedId(unknown[0].id);
      return;
    }
    setExporting(true);
    try {
      await exportInvoices(ready.map((item) => ({ invoice: item.invoice!, sourceFile: item.file.name })), parties, financialYear);
      const flagged = ready.filter((item) => item.evaluated?.status !== "OK").length;
      toast.success(flagged ? `Exported. ${flagged} invoice(s) are marked for review in the Excel file.` : "Exported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const readCount = items.filter((item) => item.invoice).length;

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster richColors position="top-right" />
      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ConverterTabs />
          <Link to="/invoice-settings" className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-muted">
            <Settings className="h-4 w-4" /> Party settings
          </Link>
        </div>

        {mode === "demo" && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Demo mode: AI reading not connected yet</AlertTitle>
            <AlertDescription>
              Only the 4 sample invoices can be read. They load their hand-typed values; the checks and the Tally export are real.
            </AlertDescription>
          </Alert>
        )}

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Invoices / Receipts to Tally Excel</h1>
              <p className="text-sm text-muted-foreground">Photos (JPG, PNG, HEIC) and PDFs, several at once. Check and correct, then export.</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" /> Invoice images are read by an AI service.
              </p>
            </div>
            <label className="text-sm">
              <span className="mr-2 font-medium">Financial year</span>
              <select value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} className="rounded-md border bg-white px-2 py-1">
                {[0, 1, 2].map((back) => {
                  const start = Number(currentFinancialYear().slice(0, 4)) - back;
                  const fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
                  return <option key={fy}>{fy}</option>;
                })}
              </select>
            </label>
          </div>

          <div
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => (e.preventDefault(), setDrag(false), addFiles(e.dataTransfer.files))}
            className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center ${drag ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm">Drop invoices here or</p>
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Choose files
            </button>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
          </div>

          {items.length > 0 && (
            <ul className="mt-4 divide-y rounded-lg border bg-white">
              {items.map((item) => (
                <li key={item.id} className={`flex items-center gap-3 p-3 ${item.id === selectedId ? "bg-primary/5" : ""}`}>
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => item.invoice && setSelectedId(item.id)} disabled={!item.invoice}>
                    <div className="truncate text-sm font-medium">{item.file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.state === "pending" && "Ready to read"}
                      {item.state === "queued" && "Queued"}
                      {item.state === "reading" && "Reading..."}
                      {item.state === "error" && <span className="text-rose-600">{item.error}</span>}
                      {item.state === "done" && (item.evaluated ? `${item.evaluated.party.name} · ${item.invoice?.invoiceNo ?? "no invoice no."}` : "Read")}
                    </div>
                  </button>
                  {(item.state === "queued" || item.state === "reading") && <Loader2 className="h-4 w-4 animate-spin text-sky-600" />}
                  {item.state === "error" && <XCircle className="h-4 w-4 text-rose-600" />}
                  {statusBadge(item.evaluated?.status)}
                  <button
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => (URL.revokeObjectURL(item.previewUrl), setItems((c) => c.filter((x) => x.id !== item.id)), selectedId === item.id && setSelectedId(null))}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={readAll}
              disabled={busy || !items.some((i) => i.state === "pending" || i.state === "error")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Read invoices
            </button>
            <button
              type="button"
              onClick={exportAll}
              disabled={exporting || readCount === 0}
              className="inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Export to Tally Excel
            </button>
          </div>
        </div>

        {selected?.invoice && (
          <ReviewPanel
            item={selected}
            onEdit={(path, value) => edit(selected.id, path, value)}
            onRotate={() => setItems((c) => c.map((x) => (x.id === selected.id ? { ...x, rotation: (x.rotation + 90) % 360 } : x)))}
            onChooseEntryType={(type) => chooseEntryType(selected, type)}
          />
        )}
      </main>
    </div>
  );
}

function ReviewPanel({
  item,
  onEdit,
  onRotate,
  onChooseEntryType,
}: {
  item: Item;
  onEdit: (path: string, value: unknown) => void;
  onRotate: () => void;
  onChooseEntryType: (type: EntryType) => void;
}) {
  const invoice = item.invoice!;
  const evaluated = item.evaluated;
  const reasonsByField = useMemo(() => {
    const map = new Map<string, Evaluated["reasons"]>();
    for (const reason of evaluated?.reasons ?? []) map.set(reason.field, [...(map.get(reason.field) ?? []), reason]);
    return map;
  }, [evaluated]);
  const confidence: Record<string, string> = invoice.confidence ?? {};

  // Cell tone: failed check (rose) > note or low confidence (amber) > medium confidence (yellow).
  // A reason on "totals" also marks every totals.* cell.
  const tone = (path: string) => {
    const reasons = [...reasonsByField.entries()].filter(([field]) => field === path || path.startsWith(`${field}.`)).flatMap(([, list]) => list);
    if (reasons.some((r) => r.level === "review")) return "border-rose-400 bg-rose-50";
    if (confidence[path] === "low" || reasons.some((r) => r.level === "note")) return "border-amber-400 bg-amber-50";
    if (confidence[path] === "medium") return "border-yellow-300 bg-yellow-50";
    return "border-input bg-white";
  };
  const isPdf = /\.pdf$/i.test(item.file.name) || item.file.type === "application/pdf";
  const isHeic = /\.hei[cf]$/i.test(item.file.name);

  const Field = ({ path, label, numeric = false }: { path: string; label: string; numeric?: boolean }) => {
    const value = getPath(invoice, path);
    return (
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <input
          defaultValue={value == null ? "" : String(value)}
          key={`${item.id}-${path}-${value ?? ""}`}
          inputMode={numeric ? "decimal" : undefined}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const next = raw === "" ? null : numeric ? Number(raw.replace(/,/g, "")) : raw;
            if (numeric && next !== null && !Number.isFinite(next)) return toast.error(`${label}: not a number`);
            if (next !== (value ?? null)) onEdit(path, next);
          }}
          title={(reasonsByField.get(path) ?? []).map((r) => r.message).join("\n") || (confidence[path] ? `${confidence[path]} confidence` : "")}
          className={`rounded-md border px-2 py-1.5 text-sm ${numeric ? "text-right tabular-nums" : ""} ${tone(path)}`}
        />
      </label>
    );
  };

  const lines: Invoice[] = invoice.lineItems ?? [];
  const lineColumns: [string, string, boolean][] = [
    ["description", "Description", false],
    ["hsnSac", "HSN/SAC", false],
    ["qty", "Qty", true],
    ["unit", "Unit", false],
    ["rate", "Rate", true],
    ["amount", "Amount", true],
    ["gstRate", "GST %", true],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="truncate text-sm font-medium">{item.file.name}</span>
          {!isPdf && !isHeic && (
            <button type="button" onClick={onRotate} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
              <RotateCw className="h-3.5 w-3.5" /> Rotate
            </button>
          )}
        </div>
        <div className="grid min-h-[480px] place-items-center overflow-auto rounded-lg bg-slate-100">
          {isPdf ? (
            <iframe title={item.file.name} src={item.previewUrl} className="h-[70vh] w-full rounded-lg" />
          ) : isHeic ? (
            <p className="p-6 text-center text-sm text-muted-foreground">HEIC photos can't be previewed in the browser. The converter reads them.</p>
          ) : (
            <img src={item.previewUrl} alt={`Invoice ${item.file.name}`} style={{ transform: `rotate(${item.rotation}deg)` }} className="max-h-[70vh] max-w-full object-contain transition-transform" />
          )}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {statusBadge(evaluated?.status)}
          {evaluated && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Tally entry type:</span>
              {evaluated.party.source === "guess" ? (
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && onChooseEntryType(e.target.value as EntryType)}
                  className="rounded-md border border-rose-400 bg-rose-50 px-2 py-1 text-sm"
                  aria-label="Choose the Tally entry type for this party"
                >
                  <option value="" disabled>
                    Choose (suggested {evaluated.party.entryType})
                  </option>
                  {ENTRY_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold">
                  {evaluated.party.entryType} <span className="font-normal text-muted-foreground">({evaluated.party.name})</span>
                </span>
              )}
            </div>
          )}
        </div>
        {evaluated?.party.source === "guess" && (
          <p className="text-xs text-rose-700">New party: choose how it is entered in Tally. It will be remembered in your party settings.</p>
        )}

        {evaluated && evaluated.reasons.length > 0 && (
          <ul className="space-y-1 rounded-lg border bg-white p-3 text-sm" role="status">
            {evaluated.reasons.map((reason, i) => (
              <li key={i} className={reason.level === "review" ? "text-rose-700" : reason.level === "incomplete" ? "text-sky-800" : "text-amber-800"}>
                {reason.level === "review" ? "Check: " : reason.level === "incomplete" ? "Incomplete: " : "Note: "}
                {reason.message}
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field path="supplier.name" label="Supplier" />
          <Field path="supplier.gstin" label="Supplier GSTIN" />
          <Field path="invoiceNo" label="Invoice no." />
          <Field path="invoiceDate" label="Invoice date (dd/mm/yyyy)" />
          <Field path="buyer.name" label="Buyer" />
          <Field path="buyer.gstin" label="Buyer GSTIN" />
          <Field path="placeOfSupply" label="Place of supply" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-1">#</th>
                {lineColumns.map(([, label, numeric]) => (
                  <th key={label} className={`p-1 ${numeric ? "text-right" : ""}`}>
                    {label}
                  </th>
                ))}
                <th className="p-1 text-right">Computed</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const check = evaluated?.computed.lines[i];
                return (
                  <tr key={i} className="align-top">
                    <td className="p-1 text-xs text-muted-foreground">{line.sno ?? i + 1}</td>
                    {lineColumns.map(([key, label, numeric]) => {
                      const path = `lineItems[${i}].${key}`;
                      const value = line[key];
                      return (
                        <td key={key} className="p-1">
                          <input
                            aria-label={`Line ${i + 1} ${label}`}
                            key={`${item.id}-${path}-${value ?? ""}`}
                            defaultValue={value ?? ""}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const next = raw === "" ? null : numeric ? Number(raw.replace(/,/g, "")) : raw;
                              if (numeric && next !== null && !Number.isFinite(next)) return toast.error(`${label}: not a number`);
                              if (next !== (value ?? null)) onEdit(path, next);
                            }}
                            className={`w-full rounded border px-1.5 py-1 ${numeric ? "text-right tabular-nums" : ""} ${tone(path)}`}
                          />
                        </td>
                      );
                    })}
                    <td className={`p-1 text-right text-xs tabular-nums ${check?.ok === false ? "font-semibold text-rose-700" : "text-muted-foreground"}`}>
                      {check?.computed != null ? check.computed.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "–"}
                    </td>
                    <td className="p-1">
                      <button type="button" aria-label={`Delete line ${i + 1}`} onClick={() => onEdit("lineItems", lines.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" onClick={() => onEdit("lineItems", [...lines, { sno: lines.length + 1 }])} className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
          {evaluated && <p className="mt-1 text-right text-xs text-muted-foreground">Sum of lines: {evaluated.computed.linesSum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field path="totals.taxableAmount" label="Taxable amount" numeric />
          <Field path="totals.cgst" label="CGST" numeric />
          <Field path="totals.sgst" label="SGST" numeric />
          <Field path="totals.igst" label="IGST" numeric />
          <Field path="totals.roundOff" label="Round off" numeric />
          <Field path="totals.grandTotal" label="Grand total" numeric />
          <Field path="totals.tcs" label="TCS" numeric />
        </div>
        <Field path="totals.amountInWords" label="Amount in words" />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field path="payment.mode" label="Payment mode" />
          <Field path="payment.reference" label="Payment ref." />
          <Field path="payment.date" label="Payment date" />
          <Field path="payment.amount" label="Amount paid" numeric />
        </div>
        {(invoice.handwrittenNotes ?? []).length > 0 && (
          <div className="rounded-lg border bg-white p-3 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Handwritten notes</div>
            <ul className="list-disc pl-5">
              {invoice.handwrittenNotes.map((note: string, i: number) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
