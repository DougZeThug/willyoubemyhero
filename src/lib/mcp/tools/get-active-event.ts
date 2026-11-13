import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseAnon } from "../supabase";
import { fail, json } from "../shared";
import { queryActiveEvent } from "../../active-event-query";

export default defineTool({
  name: "get_active_event",
  title: "Get the active combine",
  description:
    "Return the currently active draft combine — its name, year and obstacle-course stations in running order.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const sb = supabaseAnon();
    const { data: event, error } = await queryActiveEvent(sb);
    if (error) fail(error.message);
    if (!event?.id) fail("No active event right now.");
    const { data: stations } = await sb
      .from("stations")
      .select("id, name, station_order")
      .eq("event_id", event.id)
      .order("station_order", { ascending: true });
    return json({ event, stations: stations ?? [] });
  },
});
