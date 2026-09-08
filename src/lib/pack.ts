// The pack, as the client sees it.
//
// Composition used to live here too — `packSeed` and `dealPack`, a seeded
// shuffle with the last slot swapped for a card the phone did not hold. The
// deal is Postgres's now (open_pack, via pack.functions.ts): three cards from
// one pool of roster and secrets, owned or not. What stays here is the shape
// the server answers with and the small pure rules the screen and the vault
// both need, lifted out of players.pack.tsx so they can be tested without a
// browser and so the e2e suite can build the pack it expects.
import type { Edition } from "./card-edition";
import type { CompletedCollection } from "./collection-trophies";
import type { SecretCardView } from "./secret-cards";

/**
 * A roster card in the pack.
 *
 * `edition` is the finish Postgres minted for a member's copy; null when the
 * mint was rationed (the daily cap) or for a guest, who mints nothing until they
 * claim. The reveal treats null as "unknown" — it renders standard and stays
 * quiet — rather than as a standard it can celebrate.
 *
 * `heldBefore` and `editionBefore` are the collection as it stood the moment
 * the pack was dealt, from the server's own ledger. Null for a guest, whose
 * collection the server never sees; the route fills those in from the local
 * store at the tear and persists them on the row, so the ribbon reads the same
 * on every load.
 */
export type PackRosterSlot = {
  kind: "roster";
  /** `event_participants.id`. */
  id: string;
  edition: Edition | null;
  heldBefore: number | null;
  editionBefore: Edition | null;
};

/** A secret in the pack. The view is signed and sized for the stand already. */
export type PackSecretSlot = {
  kind: "secret";
  id: string;
  card: SecretCardView;
  /** Already owned. The row is a duplicate; the owned copy may have been upgraded. */
  duplicate: boolean;
  /** The level of the copy already owned, when `duplicate`. */
  tierBefore: string | null;
  /**
   * The set this slot just finished, or null — which is every slot but one in
   * a season. The one place a set SIZE ever reaches a phone, and it only ever
   * describes a set that is already complete.
   */
  completedCollection: CompletedCollection | null;
};

export type PackSlot = PackRosterSlot | PackSecretSlot;

/** What `openPack` answers. */
export type OpenPackResponse =
  | {
      ok: true;
      /** The league day the pack belongs to, `YYYY-MM-DD`. */
      day: string;
      /** False when this call resumed a pack already dealt today. */
      fresh: boolean;
      packsOpened: number;
      cards: PackSlot[];
    }
  | { ok: false; reason: "unavailable" };

/** What `getPackStatus` answers. Note the absence of a set size. */
export type PackStatus = {
  /** Has an identity a pack can be dealt to. False for a stranger. */
  claimed: boolean;
  /** Null when nobody is claimed — the server tells a stranger nothing. */
  day: string | null;
  openedToday: boolean;
  /** How many secrets this identity owns. Never how many exist. */
  secretsOwned: number;
  resetsAt: string | null;
};

/**
 * Is today's pack still sealed?
 *
 * Extracted so the nav's Pack tab and the vault's button cannot drift: two
 * places drawing the same cue off two copies of the same expression is how one
 * of them quietly starts glowing on a spent day. Leaks nothing — every field is
 * already scoped to whoever is asking, and a stranger with no status is false.
 */
export function packWaiting(status: PackStatus | null | undefined): boolean {
  return !!status?.claimed && !status.openedToday;
}

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
}): PackStage {
  const { torn, opening, packSize, cursor } = args;
  if (!torn) return "sealed";
  // Behind `torn`, because a tab left open across midnight has its pack
  // re-sealed under it by the day-tick effect, and a ceremony that outlived the
  // pack it was opening must not go on holding the screen.
  if (opening) return "opening";
  return cursor >= packSize ? "complete" : "revealing";
}

/**
 * Which card to come back to after a reload.
 *
 * Derived from what is already persisted — `PackState` carries `revealed` — so
 * resuming needs no extra stored field. The first card still face-down, or past
 * the end when every one has been seen: re-running a ceremony on every reload
 * would turn the payoff into a toll.
 */
export function resumeCursor(args: { packSize: number; revealed: readonly number[] }): number {
  const { packSize, revealed } = args;
  for (let i = 0; i < packSize; i++) {
    if (!revealed.includes(i)) return i;
  }
  return packSize;
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

/** How much of today's pack is still face-down, for the vault's Today card. */
export function cardsLeft(args: { slots: number; revealed: number }): number {
  return Math.max(0, args.slots - args.revealed);
}

/** What the vault says about today's pack: sealed, torn open, or spent. */
export type TodayPack = { state: "sealed" } | { state: "torn"; left: number } | { state: "done" };

/**
 * Read a stored pack row as one of three states, from a screen that is not the
 * pack.
 *
 * The match rule is the resume effect's, not a looser one: a row for another
 * day or another identity is not this pack, and a row carrying no identity at
 * all predates per-person packs and counts as a match — so nobody mid-reveal
 * sees the vault call their pack sealed. A row with no `cards` was written
 * before the server dealt packs; it is not today's pack either, and the pack
 * screen will deal (or resume) over it.
 */
export function todayPackState(args: {
  row: {
    dayKey: string;
    cards?: readonly unknown[];
    revealed: readonly number[];
    cursor?: number;
    identity?: string;
  } | null;
  dayKey: string;
  identity: string;
}): TodayPack {
  const { row, dayKey, identity } = args;
  const mine = row?.identity == null || row.identity === identity;
  if (!row || row.dayKey !== dayKey || !mine || !row.cards) return { state: "sealed" };
  if (row.cards.length === 0) return { state: "done" };
  const left = cardsLeft({ slots: row.cards.length, revealed: row.revealed.length });
  return left > 0 ? { state: "torn", left } : { state: "done" };
}

/** An hour in milliseconds, for the countdown below. */
const HOUR_MS = 3_600_000;

/**
 * "Next pack in 6h" — what `PackStatus.resetsAt` is fetched for.
 *
 * Hours are rounded UP, because a countdown that says 5 when 5h 50m remain reads
 * as a promise the clock then breaks. Under the hour it drops to minutes, which
 * is the only range where the difference is worth a phone screen.
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
 * yet, because the server tells a stranger nothing. The pack genuinely re-seals
 * on the league's midnight, so this is the less accurate of the two answers and
 * only the more available one.
 */
export function nextLocalMidnight(now: number): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
}
