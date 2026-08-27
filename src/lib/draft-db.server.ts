// A supabase client that will talk to the draft RPCs `types.ts` has never heard
// of.
//
// The same escape hatch streaks-db.server.ts opens, and for the same reason:
// src/integrations/supabase/types.ts is `supabase gen types` output, must not be
// hand-edited, and is .prettierignore'd — so `record_draft_selection` and
// `undo_last_draft_selection` (supabase/migrations/20260901120000_draft_selection_rpcs.sql)
// are compile errors against the generated `Database` type. Regenerating types.ts
// makes this a two-call-site removal.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function draftDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
