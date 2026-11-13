import { ToolError } from "@lovable.dev/mcp-js";
import { supabaseAnon } from "./supabase";
import { queryActiveEvent } from "../active-event-query";

/** Every tool takes an optional event id and defaults to the live combine. */
export async function resolveEventId(eventId?: string): Promise<string> {
  if (eventId) return eventId;
  const { data, error } = await queryActiveEvent(supabaseAnon());
  if (error) throw new ToolError(error.message);
  if (!data?.id) throw new ToolError("No active event. Pass an explicit event_id.");
  return data.id;
}

export function json(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

export function fail(message: string): never {
  throw new ToolError(message);
}
