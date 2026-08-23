import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Anon-key Supabase client for public reads.
 *
 * Lives in a `.server.ts` module rather than beside the handlers: the
 * `tss-serverfn-split` transform strips non-server-fn siblings out of
 * `*.functions.ts`, which broke the module ID lookup at runtime.
 */
export function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      // sb_ publishable keys are opaque, not JWTs — PostgREST rejects them as
      // a bearer token, so send them only as `apikey`.
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
