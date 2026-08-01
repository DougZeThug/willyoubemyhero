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

/**
 * How the fourth slot is doing.
 *
 * Derived rather than kept as four booleans, two of which could be true at once.
 * Lives here rather than in the route because `packStage` below branches on it
 * and is unit-tested.
 */
export type SecretSlot = "hidden" | "gated" | "pending" | "failed" | "sealed" | "open";

/**
 * Where the ceremony is up to.
 *
 * "revealing" is the one-card-at-a-time stand; "complete" is the columns. The
 * grid is the destination, never the stage — showing the final layout while cards
 * are still face-down spends the payoff before it is earned.
 */
export type PackStage = "sealed" | "revealing" | "complete";

/**
 * Whether the daily secret gets a turn on the stand.
 *
 * The secret must never be able to stall the sequence. Only a card that is
 * actually coming — one already sealed and waiting, a pull still in flight, or
 * one the user has just turned over and is still looking at — holds the stand. A
 * guest who never claimed, a pull that failed and an empty set all fall through
 * to the columns, where SecretSlotView still renders the claim gate or the retry
 * button exactly as it did before.
 */
export function secretTakesTheStand(slot: SecretSlot): boolean {
  return slot === "sealed" || slot === "pending" || slot === "open";
}

/**
 * The last cursor position the stand has something to show at.
 *
 * `packSize` is the secret's slot; without one, the last roster card is the end.
 */
export function lastStandStep(packSize: number, slot: SecretSlot): number {
  return secretTakesTheStand(slot) ? packSize : packSize - 1;
}

/**
 * Where the ceremony is.
 *
 * The cursor advances only when the user says so — revealing a card does not
 * move it, because a card you have not looked at yet is not a card you are done
 * with. Walking off the end of the stand is what hands over to the columns.
 */
export function packStage(args: {
  torn: boolean;
  packSize: number;
  cursor: number;
  secretSlot: SecretSlot;
}): PackStage {
  const { torn, packSize, cursor, secretSlot } = args;
  if (!torn) return "sealed";
  return cursor > lastStandStep(packSize, secretSlot) ? "complete" : "revealing";
}

/**
 * Which card to come back to after a reload.
 *
 * Derived from what is already persisted — `PackState` carries `revealed` and
 * `secretRevealed` — so resuming needs no extra stored field, and `PackState.ids`
 * stays exactly three roster ids.
 *
 * A secret already turned over puts the cursor past the end: that card has been
 * seen, and re-running its ceremony on every reload would turn the payoff into a
 * toll. An unrevealed secret is re-pulled by the route's effect, which re-reads
 * the day's row rather than rolling a new one, so parking on its slot is safe.
 */
export function resumeCursor(args: {
  packSize: number;
  revealed: readonly number[];
  secretRevealed: boolean;
}): number {
  const { packSize, revealed, secretRevealed } = args;
  for (let i = 0; i < packSize; i++) {
    if (!revealed.includes(i)) return i;
  }
  return secretRevealed ? packSize + 1 : packSize;
}

/**
 * Tearing the wrapper.
 *
 * Measured as horizontal *travel* from where the finger landed, not as its
 * absolute position: the previous version compared the pointer against the pack's
 * own top edge, which meant a single tap below the threshold opened the pack with
 * no drag at all.
 */
export const TEAR = {
  /** Height of the tear strip, as a fraction of the pack's height. */
  stripH: 0.15,
  /** Travel that counts as a full rip, as a fraction of the pack's width. */
  span: 0.8,
  /** Fraction of that travel which commits the tear. */
  threshold: 0.6,
} as const;

/** 0..1 across the rip, from the pointer's travel since it landed. */
export function tearProgress(startX: number, x: number, width: number): number {
  if (width <= 0) return 0;
  const p = (x - startX) / (width * TEAR.span);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
