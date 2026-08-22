// The publishable-key Supabase client — the same key the browser holds.
//
// WHY A PUBLIC HANDLER SHOULD USE THIS RATHER THAN supabaseAdmin. An unguarded
// read served by the service_role client bypasses RLS entirely, which leaves a
// hand-written column list as the only thing between a public endpoint and a
// private column: get the list wrong, or add a column to the table later, and
// the endpoint starts publishing it. Read the same rows through the anon key and
// the grants and policies in supabase/migrations are a second layer underneath
// — the one the database suite already asserts, in both directions.
//
// Not every public reader can use it. `getCardPullCounts` and `getClaimRoster`
// read tables anon is refused outright and say so at their call sites.
//
// A top-level `createClient` import is safe in this file because it is a
// *.server.ts module, which never reaches the client bundle.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function build() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        // New-style publishable keys are opaque strings, not bearer JWTs, and
        // PostgREST rejects one presented as a bearer token.
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export function publicClient() {
  return build();
}

/**
 * The same client, ungenericised, for the tables `types.ts` has never been
 * regenerated for.
 *
 * Exactly the escape hatch trades-db.server.ts and secret-cards-db.server.ts
 * open on the admin side, for the same reason: `trades` and `secret_collections`
 * are compile errors against the generated `Database` type. Recover shape per
 * query with `.returns<T>()`, which is already the house style.
 *
 * DELETE THIS once types.ts has been regenerated; every call site then switches
 * to `publicClient()` unchanged.
 */
export function publicDbClient(): SupabaseClient {
  return build() as unknown as SupabaseClient;
}
