// Row and result shapes for the dust ledger and its RPCs. `Returns: Json` can never
// give a discriminated union, so the results are written by hand.
import type { CompletedCollection } from "./collection-trophies";

/**
 * Why every one of these fails softly.
 *
 * None of them is something a person can act on by retrying differently, and all
 * of them are something to say on the button — "that is your last one", "somebody
 * has already been offered it", "not enough dust yet". Anything genuinely wrong
 * raises instead, which rolls the debit back with it.
 */
export type DustFailure =
  // The commissioner's switch is off. Not an error and not the player's doing —
  // the whole economy is simply not live yet.
  | "disabled"
  | "not_found"
  | "not_yours"
  | "last_copy"
  | "too_fresh"
  | "staked"
  | "insufficient"
  | "unavailable";

export type MillCardCopyResult =
  | {
      ok: true;
      awarded: number;
      edition: string;
      eventParticipantId: string;
      balance: number;
    }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

/**
 * Selling a secret copy, priced by its tier.
 *
 * No `last_copy` among the refusals, and that is the feature: any copy sells,
 * including your only one — the rule `trade_item_is_spare`'s secret branch
 * already keeps. `too_fresh` is no longer returned — today's pull sells like any
 * other since 20260930120000 — and stays in the vocabulary for an older server.
 */
export type SellSecretResult =
  | {
      ok: true;
      awarded: number;
      tier: string;
      secretCardId: string;
      balance: number;
    }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

/** The pull half is the same shape pull_bonus_secret_card hands back. */
export type BoughtPull = {
  pullId: string;
  cardId: string;
  day: string;
  duplicate: boolean;
  tier: string;
  granted: true;
  completedCollection: CompletedCollection | null;
};

export type BuyBonusPullResult =
  | { ok: true; price: number; balance: number; pull: BoughtPull }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

export type RerollEditionResult =
  | {
      ok: true;
      price: number;
      from: string;
      to: string;
      eventParticipantId: string;
      balance: number;
    }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };
