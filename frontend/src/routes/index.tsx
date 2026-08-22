import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { FileSpreadsheet, ScanLine, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RMH Advisors — Bank Statement PDF to Excel Converter" },
      { name: "description", content: "Convert bank statement PDFs and scanned documents to Excel in seconds. Sign up free." },
      { property: "og:title", content: "RMH Advisors PDF Converter" },
      { property: "og:description", content: "Convert bank statement PDFs and scanned documents to Excel in seconds." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading, signUp } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && user) nav({ to: "/dashboard" });
  }, [user, loading, nav]);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          RMH Advisors
        </Link>
        {/* Plain <a>, not <Link>: this app's router basepath is its own
            /__tools/acc-bankconv/ mount prefix, and it has its own internal
            /dashboard route, so <Link to="/dashboard"> would go to the wrong place. */}
        <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition">
          &larr; Back to Dashboard
        </a>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> AI-powered OCR included
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl md:text-6xl font-black tracking-tight text-black">
          Bank statements to Excel, instantly.
        </h1>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto">
          Drop any PDF — text-based or scanned — and get a clean spreadsheet. Track every conversion in your private dashboard.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={async () => {
              const sessionUser = {
                id: crypto.randomUUID(),
                email: `local+${Date.now()}@local`,
                user_metadata: { full_name: "rmhadvisors" },
              } as any;
              try {
                await signUp(sessionUser);
              } catch (e) {
                // ignore
              }
              nav({ to: "/dashboard" });
            }}
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:w-auto"
          >
            Get Started <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-left">
          <Feature icon={FileSpreadsheet} title="PDF → Excel" body="Native parsing keeps rows, columns, and amounts aligned." />
          <Feature icon={ScanLine} title="Scanned → Excel" body="On-device OCR turns image PDFs into editable data." />
          <Feature icon={ShieldCheck} title="Private history" body="Every conversion is saved to your secure dashboard." />
        </div>
      </section>
    </div>
  );
}

function Feature({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
