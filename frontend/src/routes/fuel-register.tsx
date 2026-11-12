import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ConverterTabs } from "@/components/converter-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildFuelRegister,
  COLS,
  convertFuelRegister,
  exportFuelRegister,
  getFuelConfig,
  pageImageUrl,
  readMapping,
  type BuildParams,
  type Built,
  type Col,
  type Flag,
  type MappingRow,
  type Reading,
} from "@/lib/fuel-api";

export const Route = createFileRoute("/fuel-register")({
  head: () => ({
    meta: [
      { title: "Doc OCR - RMH Advisors PDF Converter" },
      {
        name: "description",
        content: "Convert a scanned monthly fuel sales register to the Tally import sheet.",
      },
    ],
  }),
  component: FuelRegisterPage,
});

const RATE_KEYS = [
  { key: "MS", label: "Petrol (MS)" },
  { key: "HSD", label: "Diesel (HSD)" },
  { key: "HSDT", label: "Turbo diesel (HSD-T)" },
  { key: "MSP", label: "Power petrol (MSP)" },
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Indian financial year of a date: Apr-Mar.
function currentFinancialYear(now = new Date()) {
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function FuelRegisterPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [job, setJob] = useState<{
    jobId: string;
    pageCount: number;
    calls: { first: number; second: number; total: number };
  } | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const narrationDate = today(); // the export's narration date is the day it is made
  const [month, setMonth] = useState<number | "">("");
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [periodOk, setPeriodOk] = useState(false);
  const [page, setPage] = useState(1);
  const [defaults, setDefaults] = useState<{
    party: string;
    entryType: string;
    mapping: MappingRow[];
  } | null>(null);
  const [mapping, setMapping] = useState<MappingRow[]>([]);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/" });
  }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    getFuelConfig().then(
      (config) => {
        setDefaults(config);
        setMapping(readMapping(user.id, config.mapping));
      },
      () => toast.error("Could not load the Doc OCR settings."),
    );
  }, [user]);

  const params = useMemo<BuildParams | null>(() => {
    if (!reading || !defaults) return null;
    const ratesOverride: Record<string, number> = {};
    for (const [key, text] of Object.entries(rateInputs))
      if (Number(text) > 0) ratesOverride[key] = Number(text);
    return {
      reading,
      financialYear,
      narrationDate,
      month: month === "" ? undefined : month,
      ratesOverride,
      mapping,
      accepted: Object.entries(accepted).map(([id, note]) => ({ id, note })),
    };
  }, [reading, defaults, financialYear, narrationDate, month, rateInputs, accepted, mapping]);

  // Every edit re-runs all the checks on the server (debounced): the screen shows what would be exported.
  useEffect(() => {
    if (!params) return;
    const timer = setTimeout(
      () =>
        buildFuelRegister(params).then(setBuilt, (error) =>
          toast.error(error instanceof Error ? error.message : "Checks failed"),
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [params]);

  useEffect(() => setPeriodOk(false), [financialYear, month, job?.jobId]);

  async function readRegister() {
    if (!file) return;
    setBusy(true);
    setBuilt(null);
    try {
      const result = await convertFuelRegister(file);
      setJob({ jobId: result.jobId, pageCount: result.pageCount, calls: result.calls });
      setReading(result.reading);
      setAccepted({});
      setRateInputs({});
      setPage(1);
      toast.success(`Read ${result.pageCount} pages (${result.calls.total} Gemini calls).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the register");
    } finally {
      setBusy(false);
    }
  }

  // Typing over a cell: the new value is used and its "readings differ" note goes away.
  function editCell(pageNumber: number, day: number, col: Col, value: number | null) {
    setReading(
      (current) =>
        current && {
          pages: current.pages.map((p) =>
            p.page !== pageNumber
              ? p
              : {
                  ...p,
                  rows: p.rows?.map((r) =>
                    r.day !== day
                      ? r
                      : { ...r, [col]: value, edited: [...new Set([...(r.edited ?? []), col])] },
                  ),
                },
          ),
        },
    );
  }

  async function exportNow(exportAnyway: boolean) {
    if (!params) return;
    setExporting(true);
    try {
      await exportFuelRegister(params, exportAnyway);
      toast.success(
        exportAnyway && built?.unresolved ? "Exported with a Review sheet." : "Exported.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function pickFile(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    if (!picked.type.startsWith("image/") && picked.type !== "application/pdf" && !/\.(pdf|jpe?g|png|webp|heic)$/i.test(picked.name)) {
      toast.error("Please choose a PDF or an image (JPG, PNG, WEBP, HEIC).");
      return;
    }
    setFile(picked);
  }

  const party = defaults?.party ?? "JIGEESHA AUTO SERVICES";

  const flagsById = new Map((built?.flags ?? []).map((f) => [f.id, f]));
  const pageOf = (product: string) => built?.tables.find((t) => t.item === product)?.page;

  // A plain function, not a component: a nested component would remount (and drop focus) on every keystroke.
  function renderFlag(flag: Flag) {
    const target = flag.product ? pageOf(flag.product) : undefined;
    const suggestionCell =
      flag.suggestion && target && flag.day
        ? () => {
            editCell(target, flag.day!, flag.suggestion!.col, flag.suggestion!.value);
            for (const c of flag.suggestion!.companions)
              editCell(target, flag.day!, c.col, c.value);
          }
        : null;
    const cellEdit = (value: number | null) =>
      target && flag.day && flag.col && editCell(target, flag.day, flag.col, value);
    const rateEdit = (value: number | null) =>
      flag.rateKey &&
      value !== null &&
      setRateInputs((r) => ({ ...r, [flag.rateKey!]: String(value) }));
    const apply = flag.col ? cellEdit : rateEdit;
    return (
      <li
        key={flag.id}
        onClick={() => target && setPage(target)}
        className={`rounded-md border p-2 text-sm ${flag.accepted !== null ? "border-slate-200 bg-slate-50 text-slate-600" : "border-amber-300 bg-amber-50 text-amber-950"}`}
      >
        <div>{flag.reason}</div>
        {flag.values && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span>
              First reading: <b>{fmt(flag.values.first) || "blank"}</b>
            </span>
            <span>
              Second reading: <b>{fmt(flag.values.second) || "blank"}</b>
            </span>
            {flag.accepted === null && (
              <>
                <button
                  type="button"
                  className="rounded border bg-white px-2 py-0.5 hover:bg-muted"
                  onClick={() => apply(flag.values!.first)}
                >
                  Use first
                </button>
                <button
                  type="button"
                  className="rounded border bg-white px-2 py-0.5 hover:bg-muted"
                  onClick={() => apply(flag.values!.second)}
                >
                  Use second
                </button>
              </>
            )}
          </div>
        )}
        {flag.suggestion && flag.accepted === null && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span>
              Suggestion: net sales <b>{fmt(flag.suggestion.value)}</b>
              {flag.suggestion.companions.map(
                (c) => ` and meter sales ${fmt(c.value)} (as the second reading says)`,
              )}
              . {flag.suggestion.reason}
            </span>
            {suggestionCell && (
              <button
                type="button"
                className="rounded bg-primary px-2 py-0.5 text-primary-foreground"
                onClick={suggestionCell}
              >
                Use {fmt(flag.suggestion.value)}
                {flag.suggestion.companions.length ? " + meter" : ""}
              </button>
            )}
          </div>
        )}
        {flag.accepted !== null ? (
          <div className="mt-1 flex items-center gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Accepted as read
            {flag.accepted ? `: ${flag.accepted}` : ""}
            <button
              type="button"
              className="underline"
              onClick={() => setAccepted(({ [flag.id]: _removed, ...rest }) => rest)}
            >
              Undo
            </button>
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <input
              aria-label="Note for accepting"
              placeholder={
                flag.registerError ? "Note, e.g. register's own total is wrong" : "Short note"
              }
              value={notes[flag.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [flag.id]: e.target.value }))}
              className="w-64 rounded border bg-white px-2 py-0.5"
            />
            <button
              type="button"
              disabled={!(notes[flag.id] ?? "").trim()}
              onClick={() =>
                setAccepted((a) => ({ ...a, [flag.id]: (notes[flag.id] ?? "").trim() }))
              }
              className="rounded border bg-white px-2 py-0.5 hover:bg-muted disabled:opacity-40"
            >
              Accept as read
            </button>
          </div>
        )}
      </li>
    );
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const globalFlags = (built?.flags ?? []).filter((f) => !f.product && !f.rateKey);
  const rateFlags = (built?.flags ?? []).filter((f) => !f.product && f.rateKey);

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster richColors position="top-right" />
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
        <ConverterTabs />

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">
            Doc OCR: fuel sales register to Tally Excel
          </h1>
          <p className="text-sm text-muted-foreground">
            {party}: one scanned monthly register PDF (a page per product, then the rates). Every
            page is read twice; anything that differs or does not add up is flagged for you.
          </p>
          <div
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => (e.preventDefault(), setDrag(false), pickFile(e.dataTransfer.files))}
            className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center ${drag ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm">{file ? file.name : "Drop the register PDF or photo here or"}</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              {file ? "Choose another file" : "Choose file"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*"
              className="hidden"
              onChange={(e) => (pickFile(e.target.files), (e.target.value = ""))}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mr-2 font-medium">Financial year</span>
              <select
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                className="rounded-md border bg-white px-2 py-1"
              >
                {[0, 1, 2].map((back) => {
                  const start = Number(currentFinancialYear().slice(0, 4)) - back;
                  const fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
                  return <option key={fy}>{fy}</option>;
                })}
              </select>
            </label>
            <button
              type="button"
              disabled={!file || busy}
              onClick={readRegister}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Read register
            </button>
          </div>
          {busy && (
            <p className="mt-2 text-sm text-muted-foreground">
              Reading every page twice. This takes a minute or two.
            </p>
          )}
        </div>

        {built && job && (
          <>
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-6 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Period (month from the pages, year from FY {financialYear})
                  </div>
                  <div className="text-lg font-semibold">{built.period.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Sheet {built.period.sheetName}
                  </div>
                </div>
                <label className="text-sm">
                  <span className="mr-2">Month</span>
                  <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value === "" ? "" : Number(e.target.value))}
                    className="rounded-md border bg-white px-2 py-1"
                  >
                    <option value="">as read</option>
                    {MONTHS.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={periodOk}
                    onChange={(e) => setPeriodOk(e.target.checked)}
                  />{" "}
                  Period is right
                </label>
                <div className="flex items-end gap-3">
                  {RATE_KEYS.map(({ key, label }) => (
                    <label key={key} className="text-xs">
                      <div className="text-muted-foreground">{label}</div>
                      <input
                        inputMode="decimal"
                        aria-label={`Rate ${label}`}
                        value={rateInputs[key] ?? ""}
                        placeholder={
                          built.rates[key]?.read != null ? String(built.rates[key].read) : "rate"
                        }
                        onChange={(e) => setRateInputs((r) => ({ ...r, [key]: e.target.value }))}
                        className={`w-24 rounded border px-2 py-1 text-sm ${built.rates[key]?.value == null || built.rates[key]?.alt !== undefined ? "border-amber-400 bg-amber-50" : "bg-white"}`}
                      />
                    </label>
                  ))}
                </div>
                <div className="ml-auto text-right">
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${built.unresolved ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}
                  >
                    {built.unresolved ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    {built.unresolved ? `${built.unresolved} not resolved` : "All checks resolved"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {built.rows.length} rows · total{" "}
                    {fmt(
                      Math.round(built.rows.reduce((sum, r) => sum + (r.amt ?? 0), 0) * 100) / 100,
                    )}{" "}
                    · {job.calls.total} Gemini calls
                  </div>
                  <button
                    type="button"
                    disabled={!periodOk || exporting || !built.rows.length}
                    onClick={() => exportNow(built.unresolved > 0)}
                    className={`mt-2 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${built.unresolved ? "bg-amber-600 text-white" : "bg-primary text-primary-foreground"}`}
                  >
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4" />
                    )}
                    {built.unresolved ? "Export anyway (adds a Review sheet)" : "Export Excel"}
                  </button>
                  {!periodOk && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Tick "Period is right" to export.
                    </div>
                  )}
                </div>
              </div>
              {built.ignoredPages.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Ignored:{" "}
                  {built.ignoredPages
                    .map((p) => `page ${p.page} (${p.description || "not a register page"})`)
                    .join(", ")}
                  .
                </p>
              )}
              {(globalFlags.length > 0 || rateFlags.length > 0) && (
                <ul className="mt-3 space-y-2">{[...globalFlags, ...rateFlags].map(renderFlag)}</ul>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
              <div className="lg:sticky lg:top-4 lg:self-start">
                <div className="mb-2 flex flex-wrap gap-1">
                  {Array.from({ length: job.pageCount }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      className={`rounded border px-2.5 py-1 text-xs ${page === n ? "bg-primary text-primary-foreground" : "bg-white hover:bg-muted"}`}
                    >
                      Page {n}
                    </button>
                  ))}
                </div>
                <div className="max-h-[85vh] overflow-auto rounded-lg border bg-white">
                  <img
                    src={pageImageUrl(job.jobId, page)}
                    alt={`Register page ${page}`}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {built.tables.map((table) => {
                  const own = built.flags.filter((f) => f.product === table.item);
                  return (
                    <section key={table.item} className="rounded-xl border bg-card shadow-sm">
                      <button
                        type="button"
                        onClick={() => setPage(table.page)}
                        className="flex w-full items-center justify-between rounded-t-xl bg-muted/50 px-3 py-2 text-left"
                      >
                        <span className="font-medium">{table.item}</span>
                        <span className="text-xs text-muted-foreground">
                          page {table.page} · rate {fmt(table.rows[0]?.rate) || "none"} · qty{" "}
                          {fmt(table.rows.reduce((sum, r) => sum + (r.netSales ?? 0), 0))} · amount{" "}
                          {fmt(
                            Math.round(
                              table.rows.reduce((sum, r) => sum + (r.amount ?? 0), 0) * 100,
                            ) / 100,
                          )}
                        </span>
                      </button>
                      {own.length > 0 && <ul className="space-y-2 p-3">{own.map(renderFlag)}</ul>}
                      <div className="max-h-[420px] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white text-xs text-muted-foreground">
                            <tr>
                              <th className="p-1.5 text-left">Day</th>
                              {COLS.map((c) => (
                                <th key={c.key} className="p-1.5 text-right">
                                  {c.label}
                                </th>
                              ))}
                              <th className="p-1.5 text-right">Rate</th>
                              <th className="p-1.5 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {table.rows.map((row) => (
                              <tr key={row.day} className="border-t">
                                <td className="p-1.5">{row.day}</td>
                                {COLS.map(({ key }) => {
                                  const ids = row.cells[key] ?? [];
                                  const open = ids.some(
                                    (id) => flagsById.get(id)?.accepted === null,
                                  );
                                  const style = open
                                    ? "border-amber-400 bg-amber-100"
                                    : ids.length
                                      ? "border-slate-300 bg-slate-100"
                                      : "border-transparent";
                                  return (
                                    <td key={key} className="p-0.5 text-right">
                                      <input
                                        aria-label={`${table.item} day ${row.day} ${key}`}
                                        onFocus={() => setPage(table.page)}
                                        title={ids
                                          .map((id) => flagsById.get(id)?.reason)
                                          .join("\n")}
                                        inputMode="numeric"
                                        value={row[key] ?? ""}
                                        placeholder="-"
                                        onChange={(e) =>
                                          editCell(
                                            table.page,
                                            row.day,
                                            key,
                                            e.target.value.trim() === ""
                                              ? null
                                              : Number(e.target.value),
                                          )
                                        }
                                        className={`w-20 rounded border px-1.5 py-0.5 text-right tabular-nums ${style}`}
                                      />
                                    </td>
                                  );
                                })}
                                <td className="p-1.5 text-right tabular-nums">
                                  {row.netSales ? fmt(row.rate) : ""}
                                </td>
                                <td className="p-1.5 text-right tabular-nums">{fmt(row.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {!defaults && (
          <Alert>
            <AlertTitle>Loading settings</AlertTitle>
            <AlertDescription>If this stays, the backend is not running.</AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  );
}
