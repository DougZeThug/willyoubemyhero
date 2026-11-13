import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * The live combine as the public view shows it: newest active year wins. Takes
 * the client because the web app and the MCP server build their anon clients
 * differently (env resolution), but both must pick the same event.
 */
export function queryActiveEvent(sb: SupabaseClient<Database>) {
  return sb
    .from("events_public")
    .select("*")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
}
