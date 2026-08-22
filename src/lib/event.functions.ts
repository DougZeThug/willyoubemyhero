import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "./public-client.server";
import { RUNS_PUBLIC_COLUMNS } from "./runs-columns";
import { uuid as zuuid } from "./zod-uuid";

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
  .validator((data: unknown) => z.object({ eventId: zuuid() }).parse(data))
  .handler(async ({ data }) => {
    const sb = publicClient();
    // Wrap each query so a rejection or PostgREST error on one table never
    // wipes the whole bundle — participants and stations must render even
    // if splits/penalties temporarily fail. Log server-side either way.
    //
    // A failed read still coalesces to an empty array below, which reads
    // exactly like "there is nothing here" — so the labels that failed are
    // reported alongside the data and the screens can say which it was.
    const failed: string[] = [];
    const safe = async <T>(
      label: string,
      p: PromiseLike<{ data: T | null; error: unknown }>,
    ): Promise<T | null> => {
      try {
        const { data: d, error } = await p;
        if (error) {
          console.error(`[getEventBundle] ${label} error`, error);
          failed.push(label);
        }
        return d ?? null;
      } catch (e) {
        console.error(`[getEventBundle] ${label} rejected`, e);
        failed.push(label);
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
          // Named columns, not "*": anon's SELECT on runs is column-scoped, so a
          // star expands to notes/client_key too and PostgREST refuses the whole
          // read. These are exactly the columns granted to anon.
          .select(RUNS_PUBLIC_COLUMNS)
          .eq("event_id", data.eventId)
          .order("created_at", { ascending: true }),
      ),
      safe(
        "splits",
        sb.from("splits").select("*, run:runs!inner(event_id)").eq("run.event_id", data.eventId),
      ),
      safe(
        "penalties",
        sb.from("penalties").select("*, run:runs!inner(event_id)").eq("run.event_id", data.eventId),
      ),
      safe(
        "draft_selections",
        sb
          .from("draft_selections")
          .select("*")
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
      failed,
    };
  });

export const getAllParticipants = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  // Roster only: collectors hold cards but never ran the course.
  const { data } = await sb
    .from("participants")
    .select("*")
    .eq("is_collector", false)
    .order("name");
  return data ?? [];
});

export const getAllTimeRecords = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data: runs } = await sb
    .from("runs")
    .select(
      `${RUNS_PUBLIC_COLUMNS}, participant:participants(name, nickname, fantasy_team_name), event:events!inner(name, year)`,
    )
    .eq("is_official", true)
    .order("official_time_ms", { ascending: true })
    .limit(20);
  return runs ?? [];
});
