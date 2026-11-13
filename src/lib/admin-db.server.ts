/**
 * The service-role client, loaded on demand so that importing a
 * `*.functions.ts` file never drags `client.server` into the client bundle.
 * Call it inside a handler.
 */
export async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
