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

/** How many segments the rip is cut into. Enough to read as torn foil, few enough
 *  that the polygon string stays cheap to rebuild on every pointer frame. */
const TEAR_STEPS = 14;
/** Peak-to-peak wobble of the tear edge, in percent of the pack's height. */
const TEAR_JITTER = 9;

/**
 * A ragged tear edge, deterministic for a given seed so the same pack always
 * tears the same way.
 *
 * `progress` is 0 at the bottom of the pack and 1 at the top, because the thumb
 * pushes up and the edge follows it. The torn-away strip is everything below the
 * edge; `keep` is everything above.
 *
 * Callers must pass a **fresh** generator per side — `seededRng(seed)` twice,
 * never one generator reused across both calls. Reusing it walks the sequence on,
 * the two halves get different jitter, and the pieces visibly fail to line up
 * along the rip they are supposed to share.
 */
export function tearPolygon(rng: () => number, progress: number, side: "keep" | "strip"): string {
  const y = (1 - progress) * 100;
  const points: string[] = [];
  for (let i = 0; i <= TEAR_STEPS; i++) {
    const x = (i / TEAR_STEPS) * 100;
    const jitter = (rng() - 0.5) * TEAR_JITTER;
    points.push(`${x.toFixed(1)}% ${Math.min(100, Math.max(0, y + jitter)).toFixed(1)}%`);
  }
  return side === "strip"
    ? `polygon(${points.join(", ")}, 100% 100%, 0% 100%)`
    : `polygon(0% 0%, 100% 0%, ${[...points].reverse().join(", ")})`;
}
