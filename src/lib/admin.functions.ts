import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  getSessionConfig,
  hashPin,
  timingSafeEq,
  type AdminSession,
} from "./session.server";

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<AdminSession>(getSessionConfig());
  return { eventId: session.data.admin?.eventId ?? null };
});

export const verifyEventPin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ eventId: z.string().uuid(), pin: z.string().min(1).max(32) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event, error } = await supabaseAdmin
      .from("events")
      .select("id, pin_salt, pin_hash")
      .eq("id", data.eventId)
      .maybeSingle();
    if (error || !event) return { ok: false as const, reason: "event_not_found" };
    const candidate = hashPin(event.pin_salt, data.pin);
    if (!timingSafeEq(candidate, event.pin_hash)) {
      return { ok: false as const, reason: "bad_pin" };
    }
    const session = await useSession<AdminSession>(getSessionConfig());
    await session.update({ admin: { eventId: event.id, unlockedAt: Date.now() } });
    return { ok: true as const };
  });

export const adminSignOut = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<AdminSession>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});