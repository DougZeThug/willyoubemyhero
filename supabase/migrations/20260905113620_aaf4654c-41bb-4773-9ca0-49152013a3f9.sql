ALTER TABLE public.card_copies
  ADD COLUMN IF NOT EXISTS acquired_at timestamptz;

ALTER TABLE public.secret_card_pulls
  ADD COLUMN IF NOT EXISTS acquired_at timestamptz;

-- Backfill from the mint. It is the best that can be known about rows written
-- before this column existed, and it is exactly right for every copy that has
-- never changed hands, which is nearly all of them.
UPDATE public.card_copies SET acquired_at = created_at WHERE acquired_at IS NULL;
UPDATE public.secret_card_pulls SET acquired_at = created_at WHERE acquired_at IS NULL;

ALTER TABLE public.card_copies
  ALTER COLUMN acquired_at SET DEFAULT now(),
  ALTER COLUMN acquired_at SET NOT NULL;

ALTER TABLE public.secret_card_pulls
  ALTER COLUMN acquired_at SET DEFAULT now(),
  ALTER COLUMN acquired_at SET NOT NULL;

COMMENT ON COLUMN public.card_copies.acquired_at IS
  'When this copy entered its current holder''s collection. Restarted by the trigger below on every hand-over, unlike created_at, which is when the copy was minted.';

COMMENT ON COLUMN public.secret_card_pulls.acquired_at IS
  'When this pull entered its current holder''s collection. See card_copies.acquired_at.';

/**
 * Restart the clock when a row changes owner.
 *
 * BOTH SIDES MUST BE A REAL OWNER for this to fire, and that is the whole
 * subtlety. A hand-over is one person to another; the two updates that look like
 * one and are not are the guest merge in claim_guest_secrets, which sets
 * `participant_id` from NULL and `guest_id` to NULL for somebody who has just put
 * a name to the phone they were already playing on. That is a relabelling of one
 * identity, not an acquisition — stamping it would flood a new member's vault with
 * every card they pulled as a guest, presented as having arrived this second.
 *
 * Columns come in as trigger arguments so one function serves both tables:
 * card_copies has only `participant_id`, secret_card_pulls has a guest twin.
 */
CREATE OR REPLACE FUNCTION public.tg_stamp_acquired_at()
RETURNS TRIGGER AS $$
DECLARE
  _col text;
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
BEGIN
  FOREACH _col IN ARRAY TG_ARGV LOOP
    IF _old ->> _col IS NOT NULL
       AND _new ->> _col IS NOT NULL
       AND _new ->> _col <> _old ->> _col THEN
      NEW.acquired_at = now();
      RETURN NEW;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE TRIGGER card_copies_acquired_at
  BEFORE UPDATE ON public.card_copies
  FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_acquired_at('participant_id');

CREATE OR REPLACE TRIGGER secret_card_pulls_acquired_at
  BEFORE UPDATE ON public.secret_card_pulls
  FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_acquired_at('participant_id', 'guest_id');

-- The read this exists for: one member's arrivals, newest first, over a day.
CREATE INDEX IF NOT EXISTS card_copies_acquired_idx
  ON public.card_copies (participant_id, acquired_at DESC);

CREATE INDEX IF NOT EXISTS secret_card_pulls_acquired_idx
  ON public.secret_card_pulls (participant_id, acquired_at DESC);