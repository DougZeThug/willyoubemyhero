import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";
import { RUNS_PUBLIC_COLUMNS } from "@/lib/runs-columns";
import { formatTime } from "@/lib/format";
import { fail, json } from "../shared";

export default defineTool({
  name: "get_all_time_records",
  title: "Get all-time records",
  description: "Fastest official times across every combine ever held, quickest first.",
  inputSchema: {
    limit: z.number().int().optional().describe("How many rows to return (default 20, max 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const { data, error } = await supabaseAnon()
      .from("runs")
      .select(
        `${RUNS_PUBLIC_COLUMNS}, participant:participants(name, nickname, fantasy_team_name), event:events!inner(name, year)`,
      )
      .eq("is_official", true)
      .order("official_time_ms", { ascending: true })
      .limit(take);
    if (error) fail(error.message);
    const rows = (data ?? []).map((run, index) => ({
      rank: index + 1,
      ...run,
      time: formatTime(run.official_time_ms ?? 0),
    }));
    return json({ records: rows });
  },
});
