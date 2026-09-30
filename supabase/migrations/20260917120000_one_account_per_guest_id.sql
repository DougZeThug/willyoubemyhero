-- One account per guest id, said by the database rather than assumed.
--
-- 20260817194916 created account_identities with guest_id indexed but NOT
-- unique, and everything written since has quietly assumed it was. The clearest
-- case is attach_device_to_player (20260911140000), which reads
--
--   SELECT user_id, participant_id INTO _user, _bound
--     FROM public.account_identities WHERE guest_id = _guest_id FOR UPDATE;
--
-- A singular SELECT INTO with no ORDER BY and no LIMIT. plpgsql does not raise
-- on a second matching row, it silently takes whichever the scan hands back
-- first — so with two rows the repair lands on an arbitrary one of them and
-- promotes THAT account to the claimed participant.
--
-- Two rows are reachable. The device's guest token deliberately survives
-- sign-out (signOutAccount says why: it points at a collection rather than
-- authorising anybody, and clearing it orphans an unnamed visitor's cards), so
-- a second account signing in on the same handset arrived holding the same id
-- and syncAccount's first-sign-in branch adopted it again. Nothing refused the
-- insert: the only unique key on this table is the user_id primary key, which
-- is why the 23505 retry in that branch could never fire on this.
--
-- syncAccount no longer adopts or merges an id another account owns. This is
-- the backstop under it, and what lets the SELECT INTO above stay as it is.

-- Existing duplicates first, or the index below cannot be built.
--
-- The earliest row keeps the id, because it is the one that actually pulled the
-- cards filed under it; every later row is re-minted onto a fresh, empty guest
-- identity. Re-minting rather than clearing, because account_identities_one_kind
-- allows exactly one of participant_id and guest_id — a guest row with its
-- guest_id nulled is not a row this table will hold.
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

-- Partial, matching account_identities_guest_idx: a member row's guest_id is
-- NULL and any number of those may coexist.
CREATE UNIQUE INDEX IF NOT EXISTS account_identities_guest_uniq
  ON public.account_identities (guest_id) WHERE guest_id IS NOT NULL;
