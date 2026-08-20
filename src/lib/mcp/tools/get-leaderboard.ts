import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";
import { RUNS_PUBLIC_COLUMNS } from "@/lib/runs-columns";
import { formatTime } from "@/lib/format";
import { fail, json, resolveEventId } from "../shared";

export default defineTool({
  name: "get_leaderboard",
  title: "Get the leaderboard",
  description:
    "Fastest official obstacle-course times for one combine, quickest first. Defaults to the active combine.",
  inputSchema: {
    event_id: z.string().uuid().optional().describe("Event id; omit for the active combine."),
    limit: z.number().int().optional().describe("How many rows to return (default 20, max 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id, limit }) => {
    const eventId = await resolveEventId(event_id);
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const { data, error } = await supabaseAnon()
      .from("runs")
      .select(`${RUNS_PUBLIC_COLUMNS}, participant:participants(name, nickname, fantasy_team_name)`)
      .eq("event_id", eventId)
      .eq("is_official", true)
      .order("official_time_ms", { ascending: true })
      .limit(take);
    if (error) fail(error.message);
    const rows = (data ?? []).map((run, index) => ({
      rank: index + 1,
      ...run,
      // Times are milliseconds everywhere in this app; format only at the edge.
      time: formatTime(run.official_time_ms ?? 0),
    }));
    return json({ event_id: eventId, leaderboard: rows });
  },
});
