import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  FileSpreadsheet,
  Home,
  Files,
  Settings,
  LifeBuoy,
  LogOut,
  UploadCloud,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  ScanLine,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Bell,
  Shield,
  HelpCircle,
  Mail,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { convertPdfViaApi, ConversionValidationError } from "@/lib/conversion-api";
import { saveExcelBlob, getExcelBlob, deleteExcelBlob } from "@/lib/db";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard - RMH Advisors PDF Converter" },
      {
        name: "description",
        content: "Convert bank statement PDFs and scanned documents to Excel.",
      },
    ],
  }),
  component: Dashboard,
});

type Conversion = {
  id: string;
  file_name: string;
  file_size: number;
  type: "pdf" | "scanned";
  status: "queued" | "converting" | "converted" | "failed";
  rows_count: number;
  created_at: string;
};

const HISTORY_KEY = "statement-savior-history";

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function statusPill(s: Conversion["status"]) {
  const map = {
    converted: {
      c: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
      i: <CheckCircle2 className="h-3.5 w-3.5" />,
      t: "Converted",
    },
    converting: {
      c: "text-sky-600 bg-sky-50 dark:bg-sky-950/40",
      i: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      t: "Converting...",
    },
    queued: {
      c: "text-amber-600 bg-amber-50 dark:bg-amber-950/40",
      i: <Clock className="h-3.5 w-3.5" />,
      t: "Queued",
    },
    failed: {
      c: "text-rose-600 bg-rose-50 dark:bg-rose-950/40",
      i: <XCircle className="h-3.5 w-3.5" />,
      t: "Failed",
    },
  }[s];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${map.c}`}
    >
      {map.i}
      {map.t}
    </span>
  );
}

function Dashboard() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"pdf" | "scanned">("pdf");
  const [items, setItems] = useState<Conversion[]>([]);
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<"home" | "history" | "settings" | "support">("home");
  const [pending, setPending] = useState<File[]>([]);
  const [converting, setConverting] = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [showPdfPassword, setShowPdfPassword] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [notifications, setNotifications] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = (window.localStorage.getItem("theme") as "light" | "dark") ?? "light";
    setTheme(savedTheme);
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  function toggleTheme() {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    window.localStorage.setItem("theme", newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  useEffect(() => {
    console.log("dashboard auth effect", { loading, user });
    if (!loading && !user) {
      nav({ to: "/" });
    }
  }, [loading, user, nav]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HISTORY_KEY);
      if (saved) setItems(JSON.parse(saved) as Conversion[]);
    } catch {
      setItems([]);
    }
  }, []);

  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((i) => i.status === "converted").length;
    const failed = items.filter((i) => i.status === "failed").length;
    const bytes = items.reduce((a, b) => a + b.file_size, 0);
    return { total, done, failed, bytes };
  }, [items]);

  function saveHistory(next: Conversion[]) {
    setItems(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 100)));
  }

  function queueFiles(files: FileList | null) {
    if (!files) return;
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 100 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 100 MB`);
        continue;
      }

      if (mode === "pdf" && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
        toast.error(`${file.name} is not a PDF`);
        continue;
      }

      if (
        mode === "scanned" &&
        !(
          file.type === "application/pdf" ||
          file.type.startsWith("image/") ||
          /\.(pdf|jpe?g|png|tiff?|bmp)$/i.test(file.name)
        )
      ) {
        toast.error(`${file.name} is not a supported scanned file`);
        continue;
      }

      accepted.push(file);
    }
    if (accepted.length) setPending((p) => [...p, ...accepted]);
  }

  async function convertPending() {
    if (pending.length === 0 || converting) return;
    setConverting(true);
    const files = pending;
    setPending([]);
    let history = items;

    for (const file of files) {
      const base: Conversion = {
        id: crypto.randomUUID(),
        file_name: file.name,
        file_size: file.size,
        type: mode,
        status: "converting",
        rows_count: 0,
        created_at: new Date().toISOString(),
      };

      history = [base, ...history];
      saveHistory(history);

      try {
        const result = await convertPdfViaApi(file, pdfPassword.trim(), mode === "scanned");
        const rowsCount = result.rowsCount;

        // Save actual converted Excel blob to browser's IndexedDB cache
        await saveExcelBlob(base.id, result.blob);

        const finished = { ...base, status: "converted" as const, rows_count: rowsCount };
        history = [finished, ...history.filter((i) => i.id !== base.id)];
        saveHistory(history);
        toast.success(`${file.name} converted${rowsCount ? ` - ${rowsCount} rows` : ""}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        const failed = { ...base, status: "failed" as const };
        history = [failed, ...history.filter((i) => i.id !== base.id)];
        saveHistory(history);

        if (error instanceof ConversionValidationError) {
          // This is a validation result (the file was inspected and found to have nothing
          // convertible), not a crash -- no console noise, just a clear expected-failure message.
          toast.error(`${file.name} couldn't be converted: ${message}`);
        } else {
          console.error(error);
          toast.error(`${file.name} failed: ${message}`);
        }
      }
    }

    setConverting(false);
  }

  async function downloadConversion(conv: Conversion) {
    try {
      const blob = await getExcelBlob(conv.id);
      if (!blob) {
        toast.error("Converted file not found in browser cache. Please re-upload to convert again.");
        return;
      }
      const filename = conv.file_name.replace(/\.[^.]+$/, "") + ".xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      console.error(err);
      toast.error("Download failed");
    }
  }

  async function handleSignOut() {
    await signOut();
    nav({ to: "/" });
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const navItems = [
    { id: "home", label: "Home", icon: Home },
    { id: "history", label: "History", icon: Files },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "support", label: "Support Centre", icon: LifeBuoy },
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col md:flex-row">
        <div className="md:hidden border-b bg-background/95 p-4 sticky top-0 z-20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">RMH Advisors</div>
                <div className="text-xs text-muted-foreground">PDF Converter</div>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Sign out
            </button>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {navItems.map((n) => {
              const Icon = n.icon;
              const active = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  className={`min-w-[7rem] rounded-2xl border px-3 py-2 text-sm font-medium transition ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Icon className="h-4 w-4" />
                    {n.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="hidden md:flex w-64 flex-col gap-1 border-r bg-background p-4 sticky top-0 h-screen">
          <Link to="/" className="flex items-center gap-3 rounded-lg p-2">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">RMH Advisors</div>
              <div className="text-xs text-muted-foreground">PDF Converter</div>
            </div>
          </Link>
          {/* Plain <a>, not <Link>: this app's router basepath is its own
              /__tools/acc-bankconv/ mount prefix, and it has its own internal
              /dashboard route, so <Link to="/dashboard"> would go to the wrong place. */}
          <a href="/dashboard" className="mt-2 px-2 text-xs text-muted-foreground hover:text-foreground transition">
            &larr; Back to Portal Dashboard
          </a>
          <div className="mt-4 space-y-1">
            {navItems.map((n) => {
              const Icon = n.icon;
              const active = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {n.label}
                </button>
              );
            })}
          </div>
          <div className="mt-auto rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            <div className="truncate text-sm font-medium">{(user as any)?.user_metadata?.full_name ?? "rmhadvisors"}</div>
            <button
              onClick={handleSignOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </aside>

        <main className="flex-1 p-6 lg:p-10">
          <div className="mx-auto max-w-6xl grid gap-6 lg:grid-cols-1">
            {view === "home" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total" value={stats.total} />
                <StatCard label="Converted" value={stats.done} accent="text-emerald-600" />
                <StatCard label="Failed" value={stats.failed} accent="text-rose-600" />
                <StatCard label="Data processed" value={fmtSize(stats.bytes)} />
              </div>

              <div className="rounded-2xl border bg-card p-6 shadow-sm">
                <div className="space-y-4 md:flex md:items-start md:justify-between md:gap-4 md:space-y-0">
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">Convert PDF to Excel</h1>
                    <p className="text-sm text-muted-foreground">
                      Drop a file below to start converting instantly.
                    </p>
                  </div>
                </div>

                <div className="mt-4 inline-flex flex-col items-stretch gap-2 rounded-lg bg-muted p-1 sm:flex-row sm:items-center">
                  <button
                    onClick={() => setMode("pdf")}
                    className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition ${
                      mode === "pdf"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                    PDF to Excel
                  </button>
                  <button
                    onClick={() => setMode("scanned")}
                    className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition ${
                      mode === "scanned"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ScanLine className="h-4 w-4" />
                    Scanned PDF to Excel
                  </button>
                </div>

                {mode === "pdf" && (
                  <div className="mt-4 grid gap-2">
                        <label htmlFor="pdf-password" className="text-sm font-medium">
                          PDF password
                        </label>
                        <div className="relative mt-1">
                          <button
                            type="button"
                            onClick={() => setShowPdfPassword((s) => !s)}
                            aria-label={showPdfPassword ? "Hide PDF password" : "Show PDF password"}
                            className="absolute right-0 top-0 h-full flex items-center pr-3 text-muted-foreground"
                          >
                            {showPdfPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <input
                            id="pdf-password"
                            type={showPdfPassword ? "text" : "password"}
                            value={pdfPassword}
                            onChange={(e) => setPdfPassword(e.target.value)}
                            placeholder="Leave blank if not password protected"
                            className="h-10 w-full rounded-md border bg-background pl-3 pr-10 text-sm outline-none transition focus:border-primary"
                          />
                        </div>
                  </div>
                )}

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    queueFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileRef.current?.click()}
                  className={`mt-5 grid place-items-center cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition ${
                    drag
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/40 hover:bg-muted"
                  }`}
                >
                  <UploadCloud
                    className={`h-10 w-10 ${drag ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <div className="mt-3 text-sm font-medium">
                    Click or drag your {mode === "pdf" ? "PDF" : "PDF or image"} files here
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Supports {mode === "pdf" ? "text-based PDFs" : "scanned PDFs & images (OCR)"} -
                    Max 100 MB per file
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={mode === "pdf" ? "application/pdf" : "application/pdf,image/*"}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      queueFiles(e.target.files);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  />
                </div>

                {pending.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {pending.map((f, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                        <button
                          onClick={() => setPending((p) => p.filter((_, i) => i !== idx))}
                          className="text-xs text-muted-foreground hover:text-foreground"
                          disabled={converting}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  onClick={convertPending}
                  disabled={pending.length === 0 || converting}
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
                      Convert
                      {pending.length > 0
                        ? ` ${pending.length} file${pending.length > 1 ? "s" : ""}`
                        : ""}
                    </>
                  )}
                </button>
              </div>

              <div className="rounded-2xl border bg-card shadow-sm">
                <div className="flex items-center justify-between p-5 pb-3">
                  <h2 className="text-sm font-semibold">Recent conversions</h2>
                  <span className="text-xs text-muted-foreground">{items.length} total</span>
                </div>
                <div className="divide-y">
                  {items.length === 0 && (
                    <div className="p-10 text-center text-sm text-muted-foreground">
                      No conversions yet. Upload your first file above.
                    </div>
                  )}
                  {items.map((c) => (
                    <div key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.file_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtSize(c.file_size)} - {c.type === "pdf" ? "PDF" : "Scanned"} -{" "}
                          {new Date(c.created_at).toLocaleString()}
                        </div>
                      </div>
                      {statusPill(c.status)}
                      <button
                        onClick={() => downloadConversion(c)}
                        disabled={c.status !== "converted"}
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                        title={c.status === "converted" ? "Download converted file" : "Not available"}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              </div>
          )}

            {view === "history" && (
              <div className="mt-6">
                <div className="rounded-2xl border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">History — Converted files</h2>
                    <span className="text-xs text-muted-foreground">{items.filter(i => i.status === 'converted').length} converted</span>
                  </div>
                  <div className="mt-3 divide-y">
                    {items.filter((i) => i.status === "converted").length === 0 && (
                      <div className="p-4 text-xs text-muted-foreground">No converted files yet.</div>
                    )}
                    {items
                      .filter((i) => i.status === "converted")
                      .map((c) => (
                        <div key={c.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{c.file_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {fmtSize(c.file_size)} · {new Date(c.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => downloadConversion(c)}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                              title="Download converted file"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              onClick={async () => {
                                const next = items.filter((it) => it.id !== c.id);
                                saveHistory(next);
                                await deleteExcelBlob(c.id).catch(console.error);
                                toast.success("Deleted");
                              }}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                              title="Delete"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {view === "settings" && (
              <div className="mt-6 max-w-2xl">
                <div className="space-y-5">
                  {/* Theme Settings */}
                  <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <Sun className="h-5 w-5" />
                      <h2 className="text-lg font-semibold">Appearance</h2>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Theme</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Choose your preferred color theme</p>
                        </div>
                        <button
                          onClick={toggleTheme}
                          className="flex items-center gap-2 rounded-lg border bg-muted px-4 py-2 text-sm font-medium transition hover:bg-muted/80"
                        >
                          {theme === "light" ? (
                            <>
                              <Moon className="h-4 w-4" />
                              Dark
                            </>
                          ) : (
                            <>
                              <Sun className="h-4 w-4" />
                              Light
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Notifications Settings */}
                  <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <Bell className="h-5 w-5" />
                      <h2 className="text-lg font-semibold">Notifications</h2>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Email notifications</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Receive updates on conversion status</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={notifications}
                          onChange={(e) => setNotifications(e.target.checked)}
                          className="h-4 w-4 rounded border cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Privacy & Security */}
                  <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <Shield className="h-5 w-5" />
                      <h2 className="text-lg font-semibold">Privacy & Security</h2>
                    </div>
                    <div className="space-y-3">
                      <button className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition">
                        <div className="text-left">
                          <p className="text-sm font-medium">Change password</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Update your account password</p>
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </button>
                      <button className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition">
                        <div className="text-left">
                          <p className="text-sm font-medium">Two-factor authentication</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Add an extra layer of security</p>
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </button>
                    </div>
                  </div>

                  {/* Account Settings */}
                  <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <h2 className="text-lg font-semibold mb-4">Account</h2>
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-muted">
                        <p className="text-xs text-muted-foreground">Email</p>
                        <p className="text-sm font-medium mt-1">{user?.email ?? "Not set"}</p>
                      </div>
                      <button className="w-full rounded-lg border bg-background px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 transition">
                        Delete account
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {view === "support" && (
              <div className="mt-6 max-w-2xl">
                <div className="space-y-5">
                  <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <LifeBuoy className="h-5 w-5" />
                      <h2 className="text-lg font-semibold">Help & Support</h2>
                    </div>
                    <div className="space-y-3">
                      <a
                        href="#"
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition"
                      >
                        <div className="text-left">
                          <p className="text-sm font-medium">Documentation</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Browse our comprehensive guides</p>
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </a>
                      <a
                        href="#"
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition"
                      >
                        <div className="text-left">
                          <p className="text-sm font-medium">FAQ</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Find answers to common questions</p>
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </a>
                      <a
                        href="#"
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition"
                      >
                        <div className="text-left">
                          <p className="text-sm font-medium">Contact Support</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Reach out to our support team</p>
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </a>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <h2 className="text-lg font-semibold mb-4">About</h2>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <p>RMH Advisors PDF Converter v1.0.0</p>
                      <p>Convert bank statements to Excel instantly with AI-powered OCR.</p>
                      <div className="pt-3 flex gap-4">
                        <a href="#" className="text-primary hover:underline">Privacy Policy</a>
                        <a href="#" className="text-primary hover:underline">Terms of Service</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Right column removed as requested */}
          </div>
        </main>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}
