// Composing a pack.
//
// Lifted out of players.pack.tsx so the per-person behaviour can be tested
// without a browser, and so the e2e suite can compute the pack it expects rather
// than guess at one.
import { seededRng, shuffle } from "./format";

/**
 * The seed a pack is dealt from.
 *
 * The identity is what makes the pack yours. It used to be absent, so every phone
 * in the league opened the same two cards — which never made much sense when the
 * whole roster is browsable in the vault anyway, and made "how many people packed
 * this card" a number that only measured who opened the app.
 *
 * The day is still the device's local date, not the server's: a pack has no
 * identity behind it and no constraint to enforce, so there is nothing here worth
 * a round trip. (The daily secret is the opposite, and its day comes from
 * Postgres.)
 */
export function packSeed(eventId: string | null, dayKey: string, identity: string): string {
  return `${eventId ?? "no-event"}:${dayKey}:${identity}`;
}

/**
 * Deal `size` cards from the roster.
 *
 * Every slot but the last comes from a seeded shuffle, so refreshing cannot
 * reroll it. The last slot prefers a card the `baseline` does not have, which is
 * the only mechanism by which the set ever completes — `baseline` is a snapshot
 * of the collection taken when the pack was dealt, never the live one, or the
 * pack would shift under the user as they revealed it.
 */
export function dealPack<T extends { id: string }>(
  roster: readonly T[],
  seed: string,
  baseline: Record<string, unknown>,
  size: number,
): T[] {
  if (roster.length === 0) return [];
  const order = shuffle(roster, seededRng(seed));
  const picks = order.slice(0, Math.min(size, order.length));
  const missing = order.find((p) => !baseline[p.id] && !picks.slice(0, -1).includes(p));
  if (missing && picks.length === size) picks[size - 1] = missing;
  return picks;
}
