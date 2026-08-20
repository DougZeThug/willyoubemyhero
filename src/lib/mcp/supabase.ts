import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Kept import-safe on purpose: the MCP entry is module-evaluated at build time
// and on Worker cold start, where the request env does not exist yet. Every env
// read happens inside these functions, called from a tool handler.
type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  return (globalThis as RuntimeGlobals).process?.env?.[name]?.trim() || undefined;
}

function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name);
    if (value) return value;
  }
  return undefined;
}

function projectUrl(): string {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) throw new Error("SUPABASE_URL is required");
  return url;
}

function publishableKey(): string {
  const key = configuredEnv([
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ]);
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");
  return key;
}

/**
 * Anonymous, read-only client. There is no caller identity on this MCP server,
 * so RLS runs as `anon` — exactly the access a visitor to the site already has.
 * Never swap this for a service-role client: these tools are unauthenticated.
 */
export function supabaseAnon() {
  const key = publishableKey();
  return createClient<Database>(projectUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // sb_ publishable keys are opaque, not JWTs — PostgREST rejects them as a
      // bearer token, so send them only as `apikey`.
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
