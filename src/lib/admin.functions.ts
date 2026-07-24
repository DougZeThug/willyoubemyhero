import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hashPin, signAdminToken, timingSafeEq } from "./session.server";

export const verifyEventPin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ eventId: z.string().uuid(), pin: z.string().min(1).max(32) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { token, expiresAt } = signAdminToken(secret.event_id);
    return { ok: true as const, token, expiresAt };
  });