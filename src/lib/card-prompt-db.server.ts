import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Temporary ungenerated-table bridge; remove after the next Supabase type generation. */
export function cardPromptDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
