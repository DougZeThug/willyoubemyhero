import { ToolError } from "@lovable.dev/mcp-js";
import { supabaseAnon } from "./supabase";

/** Every tool takes an optional event id and defaults to the live combine. */
export async function resolveEventId(eventId?: string): Promise<string> {
  if (eventId) return eventId;
  const { data, error } = await supabaseAnon()
    .from("events_public")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ToolError(error.message);
  if (!data) throw new ToolError("No active event. Pass an explicit event_id.");
  return data.id;
}

export function json(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

export function fail(message: string): never {
  throw new ToolError(message);
}
