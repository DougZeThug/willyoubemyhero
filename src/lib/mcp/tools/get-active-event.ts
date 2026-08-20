import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseAnon } from "../supabase";
import { fail, json } from "../shared";

export default defineTool({
  name: "get_active_event",
  title: "Get the active combine",
  description:
    "Return the currently active draft combine — its name, year and obstacle-course stations in running order.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const sb = supabaseAnon();
    const { data: event, error } = await sb
      .from("events_public")
      .select("*")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error.message);
    if (!event) fail("No active event right now.");
    const { data: stations } = await sb
      .from("stations")
      .select("id, name, station_order")
      .eq("event_id", event.id)
      .order("station_order", { ascending: true });
    return json({ event, stations: stations ?? [] });
  },
});
