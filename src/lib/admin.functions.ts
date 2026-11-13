import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashPin, signAccountAdminToken, signAdminToken, timingSafeEq } from "./session.server";
import { uuid as zuuid } from "./zod-uuid";
import { activeEventId } from "./active-event.server";
import { clearAuthAttempts, noteAuthAttempt } from "./auth-attempts.server";

export const verifyEventPin = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ eventId: zuuid(), pin: z.string().min(1).max(32) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The commissioner's account path (startAdminSessionFromAccount) stays open
    // through a lockout regardless.
    if (!(await noteAuthAttempt("pin", data.eventId))) {
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
    await clearAuthAttempts("pin", data.eventId);
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
    // Both reads throw on error: the client treats "not_admin" as a settled answer
    // and never asks again, so a failed read answered that way would lock a real
    // commissioner out of the PIN-free path until they reload. A throw is retried.
    const { data: admin, error: adminError } = await supabaseAdmin
      .from("admin_accounts")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!admin) return { ok: false as const, reason: "not_admin" as const };

    const eventId = await activeEventId();
    if (!eventId) return { ok: false as const, reason: "event_not_found" as const };

    const { token, expiresAt } = signAccountAdminToken(context.userId, eventId);
    return { ok: true as const, token, expiresAt };
  });
