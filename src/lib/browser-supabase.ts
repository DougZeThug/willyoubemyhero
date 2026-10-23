// The browser Supabase client, or null when this browser cannot build one.
//
// The generated client resolves `window.localStorage` while constructing itself,
// and a browser with storage blocked (some private modes, locked-down webviews)
// throws SecurityError on that read. The generated files are not ours to edit, so
// the crash is contained here instead: every app call site goes through this, and
// a null means realtime and account sign-in are unavailable on this device while
// everything served by server functions keeps working.
import { supabase } from "@/integrations/supabase/client";

export type BrowserSupabase = typeof supabase;

let cached: BrowserSupabase | null | undefined;

export function browserSupabase(): BrowserSupabase | null {
  if (cached !== undefined) return cached;
  try {
    // Touching any property is what runs the lazy constructor behind the proxy.
    void supabase.auth;
    cached = supabase;
  } catch (err) {
    console.warn("[browser-supabase] client unavailable on this device", err);
    cached = null;
  }
  return cached;
}

/** Tests only: forget the cached answer. */
export function resetBrowserSupabaseForTests() {
  cached = undefined;
}
