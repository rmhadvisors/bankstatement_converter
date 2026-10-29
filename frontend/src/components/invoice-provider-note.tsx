import { AlertTriangle, Info } from "lucide-react";
import type { ProviderInfo } from "@/lib/invoice-api";

// Which service reads invoices and where the data goes (from /api/invoice/config).
export function InvoiceProviderNote({ provider }: { provider: ProviderInfo | null }) {
  if (!provider) return null;
  const Icon = provider.testingOnly ? AlertTriangle : Info;
  return (
    <div
      role={provider.testingOnly ? "alert" : "note"}
      className={`flex gap-2 rounded-lg border p-3 text-xs ${provider.testingOnly ? "border-rose-300 bg-rose-50 text-rose-900" : "bg-white text-muted-foreground"}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        <div className="font-medium">AI reading: {provider.configured ? provider.where : "not connected (demo mode)"}</div>
        {provider.notes.map((note) => (
          <div key={note}>{note}</div>
        ))}
      </div>
    </div>
  );
}
