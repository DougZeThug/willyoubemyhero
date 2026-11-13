import { getRequestHeader } from "@tanstack/react-start/server";
import { activeEventId } from "./active-event.server";
import { requireAdmin } from "./require-auth.server";
import { TOKEN_HEADERS } from "./token-format";

/**
 * Admin rights over a catalogue that has no event of its own.
 *
 * deleteComment authorizes a delete against the comment's own event, so an admin
 * for event A cannot touch event B. There is no row-side event here — the set is
 * league-wide by design — so the nearest honest equivalent is "admin of the
 * current combine", resolved server-side rather than taken from the payload. Last
 * year's PIN, still a valid 12-hour token if someone left a tab open, cannot edit
 * this year's set, and no handler behind this guard takes an eventId at all.
 *
 * What this is NOT: any holder of the active event's shared PIN can rewrite or
 * retire the league's permanent collection, including cards authored years
 * earlier. For a thirteen-person league that is the intended blast radius.
 *
 * Requires an active event, so out of season nobody can author secrets. That is a
 * real product constraint, stated here rather than discovered in a garden.
 */
export async function requireLeagueAdmin(): Promise<string> {
  if (!getRequestHeader(TOKEN_HEADERS.admin)) throw new Error("Admin PIN required");
  const eventId = await activeEventId();
  if (!eventId) throw new Error("Admin PIN required");
  await requireAdmin(eventId);
  return eventId;
}
