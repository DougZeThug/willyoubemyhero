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
// ONE KEY PER CARD, rather than one JSON blob for all of them. A blob has to be
// read, merged and written back, and two tabs celebrating two different cards in
// the same instant would have the later write drop the earlier one's entry — which
// replays exactly the cue this module exists to suppress. Thirteen people means
// thirteen keys at most, so there is nothing to prune and nothing to serialise.
//
// NOTHING RENDERS THIS, so there is no hook and no change event. It is read inside
// the effect that decides whether to play a cue, and a reactive view of it would be
// actively harmful: writing an entry would re-run that effect, and its cleanup
// would cancel the confetti import the same pass had just started. A cue is an
// event, not state.

const PREFIX = "wwbh:reveal-seen:";

/** The acquisition already celebrated for this card, or null for none. */
export function readRevealedAt(eventParticipantId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFIX + eventParticipantId);
  } catch {
    // Blocked storage. "Never celebrated" means the cue fires once more, which is
    // the harmless direction to fail.
    return null;
  }
}

export function markRevealed(eventParticipantId: string, acquiredAt: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + eventParticipantId, acquiredAt);
  } catch {
    /* private mode with storage blocked still holds the cue for this page load */
  }
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
 * marks the strip seen, so on the next load that card is outside the "new since"
 * filter and its timestamp is unknown again — but the store is not, and "the
 * timestamp is missing" is not "this device has never seen it". Without that row
 * the chime would come back once per session for exactly the cards somebody has
 * most recently looked at.
 *
 * Null, not false, for the unknown-and-unstored case: that is a collection built
 * before this shipped, or a card whose acquisition is older than the window, and
 * the honest answer is "no opinion" — the caller keeps its per-session guard.
 */
export function shouldCelebrate(
  storedAt: string | null,
  acquiredAt: string | null,
): boolean | null {
  if (storedAt === null) return acquiredAt ? true : null;
  if (!acquiredAt) return false;
  return acquiredAt > storedAt;
}
