// Party settings (supplier -> Tally entry type), per user. Stored in Supabase (invoice_parties,
// RLS: own rows only) when that table exists and the session is a real Supabase user; otherwise in
// this browser, so the page works before the migration is run. No client names live in the code:
// a new user's list is copied from invoice_party_defaults (seeded by a git-ignored SQL file), or in
// browser mode from the backend's demo list (a git-ignored file).
import { supabase } from "@/integrations/supabase/client";
import { getInvoiceConfig, type EntryType, type Party } from "@/lib/invoice-api";

export type PartyStore = "supabase" | "browser";
const localKey = (userId: string) => `invoice-parties:${userId}`;

// The generated Database types don't know this table yet (migration pending review).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name = "invoice_parties") => (supabase as any).from(name);

function readLocal(userId: string): Party[] | null {
  try {
    const saved = window.localStorage.getItem(localKey(userId));
    return saved ? (JSON.parse(saved) as Party[]) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId: string, parties: Party[]) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(parties));
  } catch {
    // Storage blocked: settings last for this page view only.
  }
}

export async function loadParties(userId: string): Promise<{ parties: Party[]; store: PartyStore }> {
  try {
    const { data, error } = await table().select("name, gstin, entry_type").eq("user_id", userId).order("name");
    if (error) throw error;
    if (!data.length) {
      // First use: copy the shared default list into this user's own settings.
      const defaults = await table("invoice_party_defaults").select("name, gstin, entry_type");
      if (defaults.error) throw defaults.error;
      if (defaults.data.length) {
        const { error: seedError } = await table().insert(defaults.data.map((row: { name: string; gstin: string | null; entry_type: EntryType }) => ({ user_id: userId, ...row })));
        if (seedError) throw seedError;
      }
      return { parties: defaults.data.map((row: { name: string; gstin: string | null; entry_type: EntryType }) => ({ name: row.name, gstin: row.gstin, entryType: row.entry_type })), store: "supabase" };
    }
    return { parties: data.map((row: { name: string; gstin: string | null; entry_type: EntryType }) => ({ name: row.name, gstin: row.gstin, entryType: row.entry_type })), store: "supabase" };
  } catch {
    const parties = readLocal(userId) ?? (await getInvoiceConfig().then((config) => config.defaultParties, () => []));
    writeLocal(userId, parties);
    return { parties, store: "browser" };
  }
}

// Insert or update one party (matched by name), then return the full list.
export async function saveParty(userId: string, store: PartyStore, parties: Party[], party: Party, previousName = party.name): Promise<Party[]> {
  const next = [...parties.filter((p) => p.name !== previousName && p.name !== party.name), party].sort((a, b) => a.name.localeCompare(b.name));
  if (store === "supabase") {
    if (previousName !== party.name) await table().delete().eq("user_id", userId).eq("name", previousName);
    const { error } = await table().upsert({ user_id: userId, name: party.name, gstin: party.gstin, entry_type: party.entryType, updated_at: new Date().toISOString() }, { onConflict: "user_id,name" });
    if (error) throw new Error(error.message);
  } else {
    writeLocal(userId, next);
  }
  return next;
}

export async function deleteParty(userId: string, store: PartyStore, parties: Party[], name: string): Promise<Party[]> {
  const next = parties.filter((p) => p.name !== name);
  if (store === "supabase") {
    const { error } = await table().delete().eq("user_id", userId).eq("name", name);
    if (error) throw new Error(error.message);
  } else {
    writeLocal(userId, next);
  }
  return next;
}
