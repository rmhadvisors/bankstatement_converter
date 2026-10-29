-- Invoice converter: how each supplier is entered in Tally (STOCK / NORMAL / TCS / IMPORT).
-- Review before running. No client names in this file: the starter list is inserted into
-- invoice_party_defaults by supabase/local/invoice_party_defaults.seed.sql (git-ignored).

-- Each user's own party settings.
CREATE TABLE public.invoice_parties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  gstin TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('STOCK', 'NORMAL', 'TCS', 'IMPORT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_parties TO authenticated;
GRANT ALL ON public.invoice_parties TO service_role;

ALTER TABLE public.invoice_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own invoice parties" ON public.invoice_parties
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own invoice parties" ON public.invoice_parties
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own invoice parties" ON public.invoice_parties
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own invoice parties" ON public.invoice_parties
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX invoice_parties_user_idx ON public.invoice_parties(user_id);

-- Starter list copied into a user's own settings on their first visit. Read-only for users;
-- only the service role (SQL editor / seed file) can change it.
CREATE TABLE public.invoice_party_defaults (
  name TEXT PRIMARY KEY CHECK (length(trim(name)) > 0),
  gstin TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('STOCK', 'NORMAL', 'TCS', 'IMPORT'))
);

GRANT SELECT ON public.invoice_party_defaults TO authenticated;
GRANT ALL ON public.invoice_party_defaults TO service_role;

ALTER TABLE public.invoice_party_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users read invoice party defaults" ON public.invoice_party_defaults
  FOR SELECT TO authenticated USING (true);
