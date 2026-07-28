import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
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

export const getActiveEvent = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data: event, error } = await sb
    .from("events_public")
    .select("*")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[getActiveEvent] events_public failed", error);
  return event;
});

export const getEventBundle = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ eventId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const sb = publicClient();
    // Use allSettled so a single failing sub-query never wipes the whole
    // bundle — participants and stations must render even if splits/penalties
    // temporarily fail. Each query logs its own error server-side.
    const results = await Promise.allSettled([
      sb.from("events_public").select("*").eq("id", data.eventId).maybeSingle(),
      sb
        .from("event_participants")
        .select("*, participant:participants!event_participants_participant_id_fkey(*)")
        .eq("event_id", data.eventId)
        .order("running_order", { ascending: true }),
      sb
        .from("stations")
        .select("*")
        .eq("event_id", data.eventId)
        .order("station_order", { ascending: true }),
      sb
        .from("runs")
        .select("*")
        .eq("event_id", data.eventId)
        .order("created_at", { ascending: true }),
      sb.from("splits").select("*, run:runs!inner(event_id)").eq("run.event_id", data.eventId),
      sb.from("penalties").select("*, run:runs!inner(event_id)").eq("run.event_id", data.eventId),
      sb
        .from("draft_selections")
        .select("*")
        .eq("event_id", data.eventId)
        .order("selection_order", { ascending: true }),
    ]);
    const labels = [
      "events_public",
      "event_participants",
      "stations",
      "runs",
      "splits",
      "penalties",
      "draft_selections",
    ] as const;
    const pick = <T,>(idx: number, fallback: T): T => {
      const r = results[idx];
      if (r.status === "rejected") {
        console.error(`[getEventBundle] ${labels[idx]} rejected`, r.reason);
        return fallback;
      }
      const { data: d, error } = r.value as { data: unknown; error: unknown };
      if (error) console.error(`[getEventBundle] ${labels[idx]} error`, error);
      return (d as T) ?? fallback;
    };
    return {
      event: pick<unknown>(0, null) as never,
      participants: pick(1, [] as never[]),
      stations: pick(2, [] as never[]),
      runs: pick(3, [] as never[]),
      splits: pick(4, [] as never[]),
      penalties: pick(5, [] as never[]),
      drafts: pick(6, [] as never[]),
    };
  });

export const getAllParticipants = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data } = await sb.from("participants").select("*").order("name");
  return data ?? [];
});

export const getAllTimeRecords = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data: runs } = await sb
    .from("runs")
    .select(
      "*, participant:participants(name, nickname, fantasy_team_name), event:events!inner(name, year)",
    )
    .eq("is_official", true)
    .order("official_time_ms", { ascending: true })
    .limit(20);
  return runs ?? [];
});
