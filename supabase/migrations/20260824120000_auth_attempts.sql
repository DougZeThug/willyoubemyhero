-- Rate limiting for the two endpoints that exchange a typed secret for a token.
--
-- verifyEventPin and claimPlayer are the only unauthenticated credential checks
-- in the app; every other write already sits behind a verified token. The PIN
-- validator accepts anything 1..32 characters, so nothing stops a short numeric
-- PIN — and until this table nothing counted attempts either: timingSafeEq
-- defends the comparison, not the volume.

CREATE TABLE IF NOT EXISTS public.auth_attempts (
  kind text NOT NULL,
  key text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, key)
);

ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: only service_role, which bypasses RLS, ever touches
-- this table. An attempt counter is nobody else's business — least of all the
-- caller being counted.
REVOKE ALL ON public.auth_attempts FROM anon, authenticated;

-- One atomic call per attempt: bump the counter (restarting a stale window) and
-- answer whether this attempt is still inside the allowance. Read-then-write in
-- the handler instead would hand a burst of parallel guesses the same "allowed".
CREATE OR REPLACE FUNCTION public.note_auth_attempt(
  _kind text,
  _key text,
  _window_seconds integer,
  _max integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allowed boolean;
BEGIN
  INSERT INTO public.auth_attempts AS a (kind, key, window_started_at, attempt_count)
  VALUES (_kind, _key, now(), 1)
  ON CONFLICT (kind, key) DO UPDATE SET
    -- Both CASEs read the pre-update row, so their order does not matter.
    attempt_count = CASE
      WHEN now() - a.window_started_at >= make_interval(secs => _window_seconds) THEN 1
      ELSE a.attempt_count + 1
    END,
    window_started_at = CASE
      WHEN now() - a.window_started_at >= make_interval(secs => _window_seconds) THEN now()
      ELSE a.window_started_at
    END
  RETURNING a.attempt_count <= _max INTO _allowed;
  RETURN _allowed;
END;
$$;

-- A correct secret clears the slate, so a commissioner's own typos across the
-- day never accumulate into a lockout.
CREATE OR REPLACE FUNCTION public.clear_auth_attempts(_kind text, _key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.auth_attempts WHERE kind = _kind AND key = _key;
$$;

REVOKE ALL ON FUNCTION public.note_auth_attempt(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_auth_attempts(text, text) FROM PUBLIC, anon, authenticated;
