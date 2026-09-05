// Cards whose reveal this device has already celebrated, and when.
//
// §6: landing on an owned card replays its reveal cue. The guard on
// players.$id.tsx was a module-scoped Set, so it lasted exactly as long as one
// browser session — every fresh load re-fired the chime card by card, and a good
// card re-fired the confetti, spending a little of the pack reveal's currency each
// time. The audit's fix is to key the once-guard on ACQUISITION rather than on
// module lifetime, which is what this stores.
//
// The value is the acquisition instant, not a boolean, so a card can legitimately
// celebrate twice: pull an Alice in July, trade for a second one in August, and the
// second arrival is a real event. A boolean could not tell those apart.
//
// Thirteen people on the roster means thirteen entries at most, so there is
// nothing here to prune. Same storage shape as vault-favourites.ts, with one
// deliberate difference: there is no hook and no change event.
//
// NOTHING RENDERS THIS. It is read once inside the effect that decides whether to
// play a cue, and a reactive view of it would be actively harmful — writing an
// entry would re-run that effect, and its cleanup would cancel the confetti import
// the same pass had just started. A cue is an event, not state.
const KEY = "wwbh:reveal-seen";

/** eventParticipantId -> the newest acquisition already celebrated for it. */
export type RevealSeen = Readonly<Record<string, string>>;

let current: RevealSeen = {};

function read(): RevealSeen {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "string") out[id] = at;
    }
    return out;
  } catch {
    // Blocked storage, or something else wrote junk under our key. An empty map
    // means the cue fires once more, which is the harmless direction to fail.
    return {};
  }
}

/** The stored map. Read at the moment of the cue, never rendered. */
export function readRevealSeen(): RevealSeen {
  current = read();
  return current;
}

/**
 * Whether opening this card is an event.
 *
 * Pure, so the whole rule is one table in a test rather than something you confirm
 * by opening a card and listening.
 *
 *   stored   acquiredAt   result
 *   ------   ----------   ------
 *   none     known        yes — first look at something that just arrived
 *   none     unknown      null — the caller falls back to its per-session guard
 *   present  unknown      no  — already celebrated; see below
 *   present  older        yes — a newer copy arrived, which is its own event
 *
 * THE THIRD ROW IS THE ONE THAT MATTERS. Tapping the card in the vault's strip
 * bumps wwbh:vault-last-seen, so on the next load the acquisitions window is empty
 * and this card's timestamp is unknown again — but the store is not, and "the
 * timestamp is missing" is not "this device has never seen it". Without that row
 * the chime would come back once per session for exactly the cards somebody has
 * most recently looked at.
 *
 * Null, not false, for the unknown-and-unstored case: that is a collection built
 * before this shipped, or a card whose acquisition is older than the window, and
 * the honest answer is "no opinion" — the caller keeps its per-session guard.
 */
export function shouldCelebrate(
  seen: RevealSeen,
  eventParticipantId: string,
  acquiredAt: string | null,
): boolean | null {
  const stored = seen[eventParticipantId];
  if (stored === undefined) return acquiredAt ? true : null;
  if (!acquiredAt) return false;
  return acquiredAt > stored;
}

export function markRevealed(eventParticipantId: string, acquiredAt: string) {
  // Merged onto what is actually on the phone rather than onto the module value:
  // another tab may have celebrated a different card since this one loaded, and
  // a blind overwrite would re-arm its cue.
  current = { ...read(), [eventParticipantId]: acquiredAt };
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode with storage blocked still holds the cue for this page load */
  }
}
