import { adminDb } from "./admin-db.server";

// Ten tries per key per ten minutes. Wide enough for a fumbled garden unlock,
// narrow enough that a short PIN or code stops being brute-forceable in an
// afternoon — timingSafeEq defends the comparison, this defends the volume.
const WINDOW_S = 600;
const MAX_ATTEMPTS = 10;

/**
 * Count one attempt and say whether it may proceed. Call before anything is
 * compared or looked up, so a key with no secret rate-limits exactly like one
 * with a wrong secret and the limiter never becomes an enumeration channel.
 *
 * Fails OPEN when the counter itself errors: a party locked out of its own
 * console by a limiter hiccup is a worse evening than ten extra guesses.
 *
 * `kind` + `key`: "pin" is keyed by event (a stranger hammering the gate locks
 * the gate rather than enumerating it), "claim" by the participant being claimed.
 */
export async function noteAuthAttempt(kind: "pin" | "claim", key: string): Promise<boolean> {
  const sb = await adminDb();
  const { data: allowed } = await sb.rpc("note_auth_attempt", {
    _kind: kind,
    _key: key,
    _window_seconds: WINDOW_S,
    _max: MAX_ATTEMPTS,
  });
  return allowed !== false;
}

/** A right answer wipes the counter, so the next fumble starts from zero. */
export async function clearAuthAttempts(kind: "pin" | "claim", key: string): Promise<void> {
  const sb = await adminDb();
  await sb.rpc("clear_auth_attempts", { _kind: kind, _key: key });
}
