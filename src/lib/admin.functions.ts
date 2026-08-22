import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashPin, signAdminToken, timingSafeEq } from "./session.server";
import { clearAttempts, clientIp, recordFailedAttempt, tooManyAttempts } from "./rate-limit.server";
import { uuid as zuuid } from "./zod-uuid";

export const verifyEventPin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ eventId: zuuid(), pin: z.string().min(1).max(32) }).parse(data),
  )
  .handler(async ({ data }) => {
    // Before the database, because the PIN is four digits: without a ceiling the
    // whole console is ten thousand requests away for anyone who can reach it.
    // The event id is public, so a distinct reason gives nothing away here and
    // saves the commissioner staring at "Incorrect PIN" for a correct one.
    const key = `pin:${clientIp()}:${data.eventId}`;
    if (tooManyAttempts(key)) {
      return { ok: false as const, reason: "too_many_attempts" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: secret, error } = await supabaseAdmin
      .from("event_secrets")
      .select("event_id, pin_salt, pin_hash")
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (error || !secret) {
      recordFailedAttempt(key);
      return { ok: false as const, reason: "event_not_found" as const };
    }
    const candidate = hashPin(secret.pin_salt, data.pin);
    if (!timingSafeEq(candidate, secret.pin_hash)) {
      recordFailedAttempt(key);
      return { ok: false as const, reason: "bad_pin" as const };
    }
    // A commissioner who fumbled the PIN twice before getting it right starts
    // the next window clean.
    clearAttempts(key);
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
