import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ConverterTabs } from "@/components/converter-tabs";
import { ENTRY_TYPES, type EntryType, type Party } from "@/lib/invoice-api";
import { deleteParty, loadParties, saveParty, type PartyStore } from "@/lib/invoice-parties";

export const Route = createFileRoute("/invoice-settings")({
  head: () => ({ meta: [{ title: "Invoice party settings - RMH Advisors PDF Converter" }] }),
  component: InvoiceSettingsPage,
});

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function InvoiceSettingsPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [parties, setParties] = useState<Party[] | null>(null);
  const [store, setStore] = useState<PartyStore>("browser");
  const [draft, setDraft] = useState<Party>({ name: "", gstin: null, entryType: "STOCK" });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/" });
  }, [loading, user, nav]);

  useEffect(() => {
    if (user) loadParties(user.id).then(({ parties: list, store: where }) => (setParties(list), setStore(where)));
  }, [user]);

  async function save(party: Party, previousName?: string) {
    const name = party.name.trim().toUpperCase();
    const gstin = party.gstin?.trim().toUpperCase() || null;
    if (!name) return toast.error("Party name is required");
    if (gstin && !GSTIN.test(gstin)) return toast.error(`${gstin} is not a valid GSTIN format`);
    try {
      setParties(await saveParty(user!.id, store, parties ?? [], { name, gstin, entryType: party.entryType }, previousName));
      toast.success(`${name} saved`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  if (loading || !user || !parties) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster richColors position="top-right" />
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-10">
        <ConverterTabs />
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <Link to="/invoice" className="inline-flex items-center gap-1 text-sm text-primary">
            <ArrowLeft className="h-4 w-4" /> Back to invoices
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Party settings</h1>
          <p className="text-sm text-muted-foreground">
            How each supplier is entered in Tally. Invoices are matched by GSTIN first, then by a close name match.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {store === "supabase" ? "Saved to your account." : "Saved in this browser only (the party settings table hasn't been set up yet)."}
          </p>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-2">Party name</th>
                <th className="p-2">GSTIN</th>
                <th className="p-2">Entry type</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {parties.map((party) => (
                <tr key={party.name} className="border-t">
                  <td className="p-2">
                    <input aria-label="Party name" defaultValue={party.name} onBlur={(e) => e.target.value.trim().toUpperCase() !== party.name && save({ ...party, name: e.target.value }, party.name)} className="w-full rounded border px-2 py-1" />
                  </td>
                  <td className="p-2">
                    <input aria-label={`GSTIN of ${party.name}`} defaultValue={party.gstin ?? ""} placeholder="optional" onBlur={(e) => (e.target.value.trim().toUpperCase() || null) !== party.gstin && save({ ...party, gstin: e.target.value }, party.name)} className="w-full rounded border px-2 py-1 font-mono text-xs" />
                  </td>
                  <td className="p-2">
                    <select aria-label={`Entry type of ${party.name}`} value={party.entryType} onChange={(e) => save({ ...party, entryType: e.target.value as EntryType }, party.name)} className="rounded border px-2 py-1">
                      {ENTRY_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      aria-label={`Delete ${party.name}`}
                      onClick={async () => setParties(await deleteParty(user.id, store, parties, party.name))}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="p-2">
                  <input aria-label="New party name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="New party" className="w-full rounded border px-2 py-1" />
                </td>
                <td className="p-2">
                  <input aria-label="New party GSTIN" value={draft.gstin ?? ""} onChange={(e) => setDraft({ ...draft, gstin: e.target.value })} placeholder="optional" className="w-full rounded border px-2 py-1 font-mono text-xs" />
                </td>
                <td className="p-2">
                  <select aria-label="New party entry type" value={draft.entryType} onChange={(e) => setDraft({ ...draft, entryType: e.target.value as EntryType })} className="rounded border px-2 py-1">
                    {ENTRY_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </td>
                <td className="p-2 text-right">
                  <button type="button" onClick={async () => (await save(draft)) && setDraft({ name: "", gstin: null, entryType: "STOCK" })} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
