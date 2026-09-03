import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashPin, signAdminToken, timingSafeEq } from "./session.server";
import { uuid as zuuid } from "./zod-uuid";

// Ten tries per event per ten minutes. Wide enough for a fumbled garden unlock,
// narrow enough that a short PIN stops being brute-forceable in an afternoon —
// timingSafeEq defends the comparison, this defends the volume.
const PIN_ATTEMPT_WINDOW_S = 600;
const PIN_ATTEMPT_MAX = 10;

export const verifyEventPin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ eventId: zuuid(), pin: z.string().min(1).max(32) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Counted before anything is compared, and failing OPEN when the counter
    // itself errors: a party locked out of its own console by a limiter hiccup
    // is a worse evening than ten extra guesses. Keyed by event, so a stranger
    // hammering the gate locks the gate rather than enumerating it — and the
    // commissioner's account path (startAdminSessionFromAccount) stays open
    // through a lockout regardless.
    // note_auth_attempt / clear_auth_attempts are still unknown to the generated
    // types, so this one call needs the widened client. See auth-attempts-db.server.ts.
    const { authAttemptsDb } = await import("./auth-attempts-db.server");
    const { data: allowed } = await authAttemptsDb().rpc("note_auth_attempt", {
      _kind: "pin",
      _key: data.eventId,
      _window_seconds: PIN_ATTEMPT_WINDOW_S,
      _max: PIN_ATTEMPT_MAX,
    });
    if (allowed === false) {
      return { ok: false as const, reason: "too_many_attempts" as const };
    }
    const { data: secret, error } = await supabaseAdmin
      .from("event_secrets")
      .select("event_id, pin_salt, pin_hash")
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (error || !secret) {
      return { ok: false as const, reason: "event_not_found" as const };
    }
    const candidate = hashPin(secret.pin_salt, data.pin);
    if (!timingSafeEq(candidate, secret.pin_hash)) {
      return { ok: false as const, reason: "bad_pin" as const };
    }
    // Success wipes the counter, so the next fumble starts from zero.
    await authAttemptsDb().rpc("clear_auth_attempts", { _kind: "pin", _key: data.eventId });
    const { token, expiresAt } = signAdminToken(secret.event_id);
    return { ok: true as const, token, expiresAt };
  });

/**
 * Unlock the console for an account that is on the admin list, so a signed-in
 * commissioner never has to type the PIN.
 *
 * The identity comes from the verified bearer (`requireSupabaseAuth`), never
 * from the payload, and the result is an ordinary admin token — `requireAdmin`
 * is untouched, so every write is guarded exactly as before.
 */
export const startAdminSessionFromAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: admin } = await supabaseAdmin
      .from("admin_accounts")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!admin) return { ok: false as const, reason: "not_admin" as const };

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!event) return { ok: false as const, reason: "event_not_found" as const };

    const { token, expiresAt } = signAdminToken(event.id);
    return { ok: true as const, token, expiresAt };
  });
