import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";
import { fail, json, resolveEventId } from "../shared";

export default defineTool({
  name: "list_awards",
  title: "List awards",
  description:
    "Superlatives and awards handed out at a combine, with who won each. Defaults to the active combine.",
  inputSchema: {
    event_id: z.string().uuid().optional().describe("Event id; omit for the active combine."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }) => {
    const eventId = await resolveEventId(event_id);
    const { data, error } = await supabaseAnon()
      .from("awards")
      .select("id, award_name, award_type, description, participant:participants(name, nickname)")
      .eq("event_id", eventId);
    if (error) fail(error.message);
    return json({ event_id: eventId, awards: data ?? [] });
  },
});
