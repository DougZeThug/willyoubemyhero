WITH ranked AS (
  SELECT user_id,
         row_number() OVER (PARTITION BY guest_id ORDER BY created_at, user_id) AS rn
    FROM public.account_identities
   WHERE guest_id IS NOT NULL
)
UPDATE public.account_identities a
   SET guest_id = gen_random_uuid()
  FROM ranked r
 WHERE a.user_id = r.user_id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS account_identities_guest_uniq
  ON public.account_identities (guest_id) WHERE guest_id IS NOT NULL;