// Party settings (supplier -> Tally entry type), per user, kept in this browser. No client names live in the
// code: a new user's list is copied from the backend's demo list (a git-ignored file).
import { getInvoiceConfig, type Party } from "@/lib/invoice-api";

export type PartyStore = "browser";
const localKey = (userId: string) => `invoice-parties:${userId}`;

// Export option: add the Party Settings sheet to the Excel file (off by default). Per browser.
const PARTY_SHEET_KEY = "invoice-export:party-settings-sheet";
export function readIncludePartySheet(): boolean {
  try {
    return window.localStorage.getItem(PARTY_SHEET_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeIncludePartySheet(on: boolean) {
  try {
    window.localStorage.setItem(PARTY_SHEET_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: the default (off) applies.
  }
}

// Reading option: "Double-check handwritten bills" (off by default). Per browser; the server only
// honours it when both providers are confirmed.
const DOUBLE_CHECK_KEY = "invoice-read:double-check";
export function readDoubleCheck(): boolean {
  try {
    return window.localStorage.getItem(DOUBLE_CHECK_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeDoubleCheck(on: boolean) {
  try {
    window.localStorage.setItem(DOUBLE_CHECK_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: the default (off) applies.
  }
}

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
  const parties = readLocal(userId) ?? (await getInvoiceConfig().then((config) => config.defaultParties, () => []));
  writeLocal(userId, parties);
  return { parties, store: "browser" };
}

// Insert or update one party (matched by name), then return the full list.
export async function saveParty(userId: string, _store: PartyStore, parties: Party[], party: Party, previousName = party.name): Promise<Party[]> {
  const next = [...parties.filter((p) => p.name !== previousName && p.name !== party.name), party].sort((a, b) => a.name.localeCompare(b.name));
  writeLocal(userId, next);
  return next;
}

export async function deleteParty(userId: string, _store: PartyStore, parties: Party[], name: string): Promise<Party[]> {
  const next = parties.filter((p) => p.name !== name);
  writeLocal(userId, next);
  return next;
}
