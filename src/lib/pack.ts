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
 * "opening" is the rip finishing and the cards leaving the pack; "revealing" is
 * the one-card-at-a-time stand; "complete" is the columns. The grid is the
 * destination, never the stage — showing the final layout while cards are still
 * face-down spends the payoff before it is earned.
 */
export type PackStage = "sealed" | "opening" | "revealing" | "complete";

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
  /** The opening ceremony is still playing. Its timeline is in pack-ceremony.ts. */
  opening: boolean;
  packSize: number;
  cursor: number;
  secretSlot: SecretSlot;
}): PackStage {
  const { torn, opening, packSize, cursor, secretSlot } = args;
  if (!torn) return "sealed";
  // Both orderings here are load-bearing.
  //
  // Behind `torn`, because a tab left open across midnight has its pack re-sealed
  // under it by the day-tick effect, and a ceremony that outlived the pack it was
  // opening must not go on holding the screen.
  //
  // Ahead of the cursor check, because the daily secret is pulled the moment the
  // pack is dealt — so `secretSlot` moves under the ceremony while it plays, and
  // without this the stage could flip out from under a running animation.
  if (opening) return "opening";
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

/**
 * How much of today's pack is still face-down, for the vault's Today card.
 *
 * The fourth slot only counts when one is genuinely owed — `secretOwed` is the
 * caller's `secretOwed(status)`, so a guest with no actor, a day whose set is
 * spent and a device that has already turned the card all leave it out rather
 * than promising a card that is not coming. NOT `secretWaiting`, which goes
 * false the moment the pull lands and would call a pack with an unturned secret
 * on the stand finished. Same rule `secretTakesTheStand` applies on the pack
 * screen, asked from the one piece of state a screen that is not the pack can
 * actually see.
 */
export function cardsLeft(args: {
  ids: number;
  revealed: number;
  secretRevealed: boolean;
  secretOwed: boolean;
}): number {
  const { ids, revealed, secretRevealed, secretOwed } = args;
  const roster = Math.max(0, ids - revealed);
  return roster + (secretOwed && !secretRevealed ? 1 : 0);
}

/** What the vault says about today's pack: sealed, torn open, or spent. */
export type TodayPack = { state: "sealed" } | { state: "torn"; left: number } | { state: "done" };

/**
 * Read a stored pack row as one of three states, from a screen that is not the
 * pack.
 *
 * The match rule is the resume effect's, not a looser one (players.pack.tsx:503):
 * a row for another day or another identity is not this pack, and a row carrying
 * no identity at all predates per-person packs and counts as a match — so nobody
 * mid-reveal sees the vault call their pack sealed.
 *
 * The replay case is the subtle one. A row with no cursor and everything
 * revealed is what the pre-stand ceremony wrote, and the pack screen turns those
 * cards face-down again to play them through the stand (`replay`, :517). Calling
 * that "done" here would have the two screens disagree about whether there is
 * anything left to open, so it is `torn` with the whole pack still to turn.
 */
export function todayPackState(args: {
  row: {
    dayKey: string;
    ids: readonly string[];
    revealed: readonly number[];
    secretRevealed?: boolean;
    cursor?: number;
    identity?: string;
  } | null;
  dayKey: string;
  identity: string;
  secretOwed: boolean;
}): TodayPack {
  const { row, dayKey, identity, secretOwed } = args;
  const mine = row?.identity == null || row.identity === identity;
  if (!row || row.dayKey !== dayKey || !mine || row.ids.length === 0) return { state: "sealed" };

  const replay = row.cursor === undefined && row.revealed.length >= row.ids.length;
  const left = cardsLeft({
    ids: row.ids.length,
    revealed: replay ? 0 : row.revealed.length,
    secretRevealed: !replay && !!row.secretRevealed,
    secretOwed,
  });
  return left > 0 ? { state: "torn", left } : { state: "done" };
}

/** An hour in milliseconds, for the countdown below. */
const HOUR_MS = 3_600_000;

/**
 * "Next pack in 6h" — the one thing `SecretDayStatus.resetsAt` has always been
 * fetched for and never rendered (§3).
 *
 * Hours are rounded UP, because a countdown that says 5 when 5h 50m remain reads
 * as a promise the clock then breaks. Under the hour it drops to minutes, which
 * is the only range where the difference is worth a phone screen.
 *
 * The instant itself is an approximation and the caller's comment says why: the
 * secret rolls over on the league's midnight and the pack on the device's, so
 * these are two clocks and this prints whichever the caller had.
 */
export function nextPackLabel(nextPackAt: string | null, now: number): string {
  if (!nextPackAt) return "Next pack tomorrow";
  const at = Date.parse(nextPackAt);
  if (Number.isNaN(at)) return "Next pack tomorrow";
  const ms = at - now;
  if (ms <= 0) return "Next pack any moment now";
  if (ms < HOUR_MS) return `Next pack in ${Math.max(1, Math.ceil(ms / 60_000))}m`;
  return `Next pack in ${Math.ceil(ms / HOUR_MS)}h`;
}

/**
 * Midnight tonight, where this phone is standing, as an ISO instant.
 *
 * The fallback for `resetsAt` being null — which is every device with no actor
 * yet, because the server tells a stranger nothing. It is also the clock the
 * pack genuinely re-seals on (`todayKey`), so this is the more accurate of the
 * two answers and only the less available one.
 */
export function nextLocalMidnight(now: number): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
}
