// A supabase client that will talk to the trophy table `types.ts` has never heard
// of.
//
// The same escape hatch secret-cards-db.server.ts, trades-db.server.ts and
// streaks-db.server.ts open, and for the same reason:
// src/integrations/supabase/types.ts is `supabase gen types` output, must not be
// hand-edited, and is .prettierignore'd — so `collection_trophies` is a compile
// error against the generated `Database` type, which is an alias rather than an
// interface and so cannot be rescued by declaration merging.
//
// Only the TABLE needs this. `award_collection_trophy` is never called from
// TypeScript — it is called from inside the three acquiring RPCs, which is the
// whole point of putting detection in SQL — and the three RPCs that DO carry its
// result already declare `Returns: Json`, so their generated signatures did not
// change and their call sites stay on the typed client.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CollectionTrophyRow = {
  participant_id: string;
  collection_id: string;
  completed_on: string;
  size_at_completion: number;
  /** Unconstrained here; the CHECK lives in the migration and TrophyVia mirrors it. */
  via: string;
  event_id: string | null;
  created_at: string;
};

export function trophiesDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
