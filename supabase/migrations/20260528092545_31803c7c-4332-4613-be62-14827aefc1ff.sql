
CREATE TABLE public.conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'pdf',
  status TEXT NOT NULL DEFAULT 'converted',
  rows_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversions TO authenticated;
GRANT ALL ON public.conversions TO service_role;

ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own conversions" ON public.conversions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own conversions" ON public.conversions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own conversions" ON public.conversions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own conversions" ON public.conversions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX conversions_user_created_idx ON public.conversions(user_id, created_at DESC);
