import { adminDb } from "./admin-db.server";

/**
 * The live combine, resolved server-side rather than taken from the caller: an
 * event id in a payload is spoofable and, on a screen that renders before the
 * event query answers, racy. Null only when no event is active (out of season);
 * a failed lookup throws, so an outage cannot read as "no event" and stamp a
 * write with none.
 */
export async function activeEventId(): Promise<string | null> {
  const sb = await adminDb();
  const { data, error } = await sb
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
