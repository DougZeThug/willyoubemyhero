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

/**
 * The columns the public is allowed to read, named rather than starred.
 *
 * These three tables are granted to `anon` a column at a time — private notes,
 * internal actor labels and the client idempotency keys are not among them — and
 * a column-level grant is incompatible with `select("*")`, because `*` asks for
 * every column and Postgres refuses the lot if one of them is not granted.
 *
 * That incompatibility is the whole reason the narrow grants were quietly
 * replaced by table-wide ones in 20260811224354, handing anon back the private
 * columns to make the bundle load again. Naming the columns here is what lets
 * the grants go back to being narrow, so the two stay in step: **if you add a
 * column to one of these lists, add it to the matching GRANT as well.**
 */
const PUBLIC_RUN_COLUMNS =
  "id, event_id, participant_id, attempt_number, started_at, finished_at, raw_time_ms, paused_duration_ms, penalty_ms, official_time_ms, status, is_official, created_at, updated_at";
const PUBLIC_PENALTY_COLUMNS = "id, run_id, station_id, penalty_ms, reason, created_at";
const PUBLIC_DRAFT_COLUMNS =
  "id, event_id, participant_id, selection_order, draft_position, selected_at";

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
    // Wrap each query so a rejection or PostgREST error on one table never
    // wipes the whole bundle — participants and stations must render even
    // if splits/penalties temporarily fail. Log server-side either way.
    const safe = async <T>(
      label: string,
      p: PromiseLike<{ data: T | null; error: unknown }>,
    ): Promise<T | null> => {
      try {
        const { data: d, error } = await p;
        if (error) console.error(`[getEventBundle] ${label} error`, error);
        return d ?? null;
      } catch (e) {
        console.error(`[getEventBundle] ${label} rejected`, e);
        return null;
      }
    };
    const [event, participants, stations, runs, splits, penalties, drafts] = await Promise.all([
      safe(
        "events_public",
        sb.from("events_public").select("*").eq("id", data.eventId).maybeSingle(),
      ),
      safe(
        "event_participants",
        sb
          .from("event_participants")
          .select("*, participant:participants!event_participants_participant_id_fkey(*)")
          .eq("event_id", data.eventId)
          .order("running_order", { ascending: true }),
      ),
      safe(
        "stations",
        sb
          .from("stations")
          .select("*")
          .eq("event_id", data.eventId)
          .order("station_order", { ascending: true }),
      ),
      safe(
        "runs",
        sb
          .from("runs")
          .select(PUBLIC_RUN_COLUMNS)
          .eq("event_id", data.eventId)
          .order("created_at", { ascending: true }),
      ),
      safe(
        "splits",
        sb.from("splits").select("*, run:runs!inner(event_id)").eq("run.event_id", data.eventId),
      ),
      safe(
        "penalties",
        sb
          .from("penalties")
          .select(`${PUBLIC_PENALTY_COLUMNS}, run:runs!inner(event_id)`)
          .eq("run.event_id", data.eventId),
      ),
      safe(
        "draft_selections",
        sb
          .from("draft_selections")
          .select(PUBLIC_DRAFT_COLUMNS)
          .eq("event_id", data.eventId)
          .order("selection_order", { ascending: true }),
      ),
    ]);
    return {
      event,
      participants: participants ?? [],
      stations: stations ?? [],
      runs: runs ?? [],
      splits: splits ?? [],
      penalties: penalties ?? [],
      drafts: drafts ?? [],
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
      `${PUBLIC_RUN_COLUMNS}, participant:participants(name, nickname, fantasy_team_name), event:events!inner(name, year)`,
    )
    .eq("is_official", true)
    .order("official_time_ms", { ascending: true })
    .limit(20);
  return runs ?? [];
});
