CREATE TABLE IF NOT EXISTS public.admin_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_accounts TO service_role;

ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.admin_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.admin_accounts
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.admin_accounts (user_id, note)
SELECT id, 'seeded: event owner' FROM auth.users WHERE email = 'doug.weidensaul@gmail.com'
ON CONFLICT (user_id) DO NOTHING;