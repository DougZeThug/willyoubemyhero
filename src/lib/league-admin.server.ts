import { getRequestHeader } from "@tanstack/react-start/server";
import { requireAdmin } from "./require-auth.server";

/** Authorizes league-wide authoring against the current active event's admin token. */
export async function requireLeagueAdmin(): Promise<string> {
  if (!getRequestHeader("x-admin-token")) throw new Error("Admin PIN required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: event } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!event) throw new Error("Admin PIN required");
  await requireAdmin(event.id);
  return event.id;
}
