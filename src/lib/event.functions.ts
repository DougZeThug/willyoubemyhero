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
        if (
          key.startsWith("sb_") &&
          headers.get("Authorization") === `Bearer ${key}`
        ) {
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
  const { data: event } = await sb
    .from("events_public")
    .select("*")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  return event;
});

export const getEventBundle = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ eventId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [event, participants, stations, runs, splits, penalties, drafts] =
      await Promise.all([
        sb.from("events_public").select("*").eq("id", data.eventId).maybeSingle(),
        sb
          .from("event_participants")
          .select("*, participant:participants(*)")
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
        sb.from("splits").select("*"),
        sb.from("penalties").select("*"),
        sb
          .from("draft_selections")
          .select("*")
          .eq("event_id", data.eventId)
          .order("selection_order", { ascending: true }),
      ]);
    return {
      event: event.data,
      participants: participants.data ?? [],
      stations: stations.data ?? [],
      runs: runs.data ?? [],
      splits: splits.data ?? [],
      penalties: penalties.data ?? [],
      drafts: drafts.data ?? [],
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
    .select("*, participant:participants(name, nickname, fantasy_team_name), event:events!inner(name, year)")
    .eq("is_official", true)
    .order("official_time_ms", { ascending: true })
    .limit(20);
  return runs ?? [];
});