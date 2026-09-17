// A supabase client that will talk to the run-result RPC `types.ts` has never
// heard of.
//
// The same escape hatch draft-db.server.ts opens, and for the same reason:
// src/integrations/supabase/types.ts is `supabase gen types` output, must not be
// hand-edited, and is .prettierignore'd — so `update_run_result`
// (supabase/migrations/20260917130000_replace_a_run_result_in_one_transaction.sql)
// is a compile error against the generated `Database` type. Regenerating
// types.ts makes this a one-call-site removal.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function runResultDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
