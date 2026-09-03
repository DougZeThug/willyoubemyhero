// A supabase client that will talk to the lockout RPCs `types.ts` has never heard
// of.
//
// The last of the drift shims. `note_auth_attempt` and `clear_auth_attempts`
// back the PIN and member-code lockouts and were never picked up by
// `supabase gen types`, so calling them on the typed client is a compile error —
// and `Database` is a type alias rather than an interface, so declaration merging
// cannot rescue it. Every other shim retired when types.ts was regenerated; this
// one stays until these two functions appear in it.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function authAttemptsDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
