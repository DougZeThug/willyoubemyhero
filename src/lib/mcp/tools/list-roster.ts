import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";
import { fail, json, resolveEventId } from "../shared";

export default defineTool({
  name: "list_roster",
  title: "List the roster",
  description:
    "List everyone in a combine's roster with their running order, run status and trading-card rarity. Defaults to the active combine.",
  inputSchema: {
    event_id: z.string().uuid().optional().describe("Event id; omit for the active combine."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }) => {
    const eventId = await resolveEventId(event_id);
    const { data, error } = await supabaseAnon()
      .from("event_participants")
      .select(
        "id, running_order, status, card_rarity, participant:participants!event_participants_participant_id_fkey(id, name, nickname, fantasy_team_name)",
      )
      .eq("event_id", eventId)
      .order("running_order", { ascending: true });
    if (error) fail(error.message);
    return json({ event_id: eventId, roster: data ?? [] });
  },
});
