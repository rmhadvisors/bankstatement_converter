import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { convertCreditCardViaApi, type CreditCardConvertResult } from "@/lib/conversion-api";
import { saveExcelBlob } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConverterTabs } from "@/components/converter-tabs";

export const Route = createFileRoute("/credit-card")({
  head: () => ({
    meta: [
      { title: "Credit Card Statement - RMH Advisors PDF Converter" },
      { name: "description", content: "Convert credit card statement PDFs to Excel." },
    ],
  }),
  component: CreditCardPage,
});

// Shared with the dashboard's history list, which shows card conversions too.
const HISTORY_KEY = "statement-savior-history";
const MAX_BYTES = 100 * 1024 * 1024;
const PASSWORD_CODES = new Set(["PASSWORD_REQUIRED", "WRONG_PASSWORD"]);

function addToHistory(entry: Record<string, unknown>) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]") as unknown[];
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...saved].slice(0, 100)));
  } catch {
    // History is a convenience; a full or blocked localStorage must not fail the conversion.
  }
}

function CreditCardPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordProblem, setPasswordProblem] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreditCardConvertResult | null>(null);
  const [converting, setConverting] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/" });
  }, [loading, user, nav]);

  useEffect(() => {
    if (passwordProblem) passwordRef.current?.focus();
  }, [passwordProblem]);

  function pick(files: FileList | null) {
    const next = files?.[0];
    if (!next) return;
    if (next.size > MAX_BYTES) {
      toast.error(`${next.name} exceeds 100 MB`);
      return;
    }
    if (!(next.type === "application/pdf" || next.type.startsWith("image/") || /\.(pdf|jpe?g|png|tiff?)$/i.test(next.name))) {
      toast.error(`${next.name} is not a PDF or image`);
      return;
    }
    setFile(next);
    setError("");
    setResult(null);
    setPasswordProblem("");
  }

  async function convert() {
    if (!file || converting) return;
    setConverting(true);
    setError("");
    setResult(null);
    const entry = {
      id: crypto.randomUUID(),
      file_name: file.name,
      file_size: file.size,
      type: "pdf",
      statement_type: "credit_card",
      created_at: new Date().toISOString(),
    };

    try {
      const converted = await convertCreditCardViaApi(file, password.trim());
      await saveExcelBlob(entry.id, converted.blob);
      addToHistory({ ...entry, status: "converted", rows_count: converted.rowsCount });
      setResult(converted);
      setPasswordProblem("");
      toast.success(`${file.name} converted - ${converted.rowsCount} transactions`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "Unknown error";
      if (code && PASSWORD_CODES.has(code)) {
        setPasswordProblem(message);
      } else {
        addToHistory({ ...entry, status: "failed", rows_count: 0 });
        setError(message);
      }
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster richColors position="top-right" />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-10">
        <ConverterTabs />

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Credit Card Statement to Excel</h1>
          <p className="text-sm text-muted-foreground">
            Transactions, statement summary and a reconciliation check against the total amount due.
          </p>

          <div className="mt-4 grid gap-2">
            <label htmlFor="card-pdf-password" className="text-sm font-medium">
              PDF password <span className="font-normal text-muted-foreground">(if the statement is protected)</span>
            </label>
            <div className="relative">
              <input
                id="card-pdf-password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Often first 4 letters of your name + DDMM of birth"
                aria-invalid={Boolean(passwordProblem)}
                aria-describedby={passwordProblem ? "card-password-problem" : undefined}
                className={`h-10 w-full rounded-md border bg-background pl-3 pr-10 text-sm outline-none transition focus:border-primary ${
                  passwordProblem ? "border-rose-500" : ""
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide PDF password" : "Show PDF password"}
                className="absolute right-0 top-0 flex h-full items-center pr-3 text-muted-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordProblem && (
              <p id="card-password-problem" role="alert" className="text-sm text-rose-600">
                {passwordProblem}
              </p>
            )}
          </div>

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
            className={`mt-5 grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-12 text-center transition ${
              drag ? "border-primary bg-primary/5" : "border-border bg-muted/40 hover:bg-muted"
            }`}
          >
            <UploadCloud className={`h-10 w-10 ${drag ? "text-primary" : "text-muted-foreground"}`} />
            <div className="mt-3 text-sm font-medium">Click or drag your credit card statement here</div>
            <div className="mt-1 text-xs text-muted-foreground">PDF or image - Max 100 MB</div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                pick(e.target.files);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
          </div>

          {file && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 truncate">{file.name}</span>
              <button
                onClick={() => setFile(null)}
                disabled={converting}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            </div>
          )}

          <button
            onClick={convert}
            disabled={!file || converting}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {converting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-4 w-4" />
                {passwordProblem ? "Retry with password" : "Convert"}
              </>
            )}
          </button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{file?.name ?? "Statement"} couldn't be converted</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && result.reconciliationStatus === "OK" && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>
              {result.fileName} downloaded - {result.rowsCount} transactions
            </AlertTitle>
            <AlertDescription>The transactions reconcile with the statement's total amount due.</AlertDescription>
          </Alert>
        )}

        {result && result.reconciliationStatus !== "OK" && (
          <Alert className="border-amber-500/60 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>
              {result.fileName} downloaded, but check it - {result.rowsCount} transactions
            </AlertTitle>
            <AlertDescription>
              {result.reconciliationWarning ||
                "The transactions could not be reconciled with the statement summary."}{" "}
              Compare it with the statement; the workbook's Summary sheet shows the difference.
            </AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  );
}
