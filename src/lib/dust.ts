// Dust: the prices, and what a spare is worth.
//
// Client-safe and pure. Every number here is mirrored in Postgres — the mill
// ladder in `mill_value`, the credit inside `pull_secret_card`, the prices inside
// `buy_bonus_secret_pull` and `reroll_copy_edition` — and `tests/db/dust.test.ts`
// imports this file to pin the two together. The database is authoritative: these
// exist so the shop can print a price before the call, and a disagreement is a
// sheet that promises one payout while the ledger files another.
//
// Named `dust` rather than `tokens` on purpose. `src/lib` already means auth when
// it says token — member-token.ts, admin-token.ts, session.server.ts — and a
// tokens.ts sitting next to those, holding a currency, is a security review
// waiting to read the wrong file.
import { EDITION_ORDER, type Edition } from "./card-edition";

/**
 * Whether the dust economy is switched on, read off the active event.
 *
 * The commissioner's switch (`events.dust_enabled`, 20260828120000). Postgres
 * enforces it — every dust RPC refuses while it is off, and nothing accrues —
 * so this is only about whether to render the chip and the shop at all. A stale
 * `true` here costs a button that answers "not yet"; it cannot spend anything.
 *
 * Takes `unknown` and narrows here, because `dust_enabled` is not in the
 * generated event type yet: `src/integrations/supabase/types.ts` is
 * `supabase gen types` output and must not be hand-edited. Declaring the
 * parameter as `{ dust_enabled?: boolean }` does not work either — an all-
 * optional type triggers TypeScript's weak-type check and rejects an event that
 * has none of its properties. So the cast lives here, once, rather than at every
 * call site. It stops being needed the next time those types are regenerated.
 */
export function dustLive(event: unknown): boolean {
  return !!(event as { dust_enabled?: boolean | null } | null | undefined)?.dust_enabled;
}

/**
 * What a duplicate secret pays.
 *
 * The dupe was the one moment in the day that felt like nothing — the code called
 * the ceremony "a tax" after the third — so it is the one that pays. Members
 * only: `dust_ledger` is keyed on a participant, and a guest's dust would be
 * earnable and barely spendable.
 */
export const DUPE_SECRET_CREDIT = 25;

/**
 * What milling a spare roster copy pays, by finish.
 *
 * Only for a copy whose finish Postgres decided. Anything a phone or a
 * commissioner asserted pays {@link MILL_CLIENT_FLAT} however rare it claims to
 * be — see `card_copies.edition_asserted_by`.
 */
export const MILL_BY_EDITION: Record<Edition, number> = {
  platinum: 100,
  gold: 40,
  silver: 20,
  bronze: 10,
  standard: 5,
};

/**
 * What a copy pays when nobody trustworthy decided its finish.
 *
 * The floor rather than a refusal: those copies are real cards somebody really
 * pulled, and the pre-R4 fleet is full of them. Paying the floor is what makes
 * forging a platinum pointless without punishing anyone for having played early.
 */
export const MILL_CLIENT_FLAT = 5;

/** The sinks. */
export const DUST_PRICES = {
  /**
   * A bonus secret pull. About one a week for somebody playing daily, which is
   * the rate this is tuned to rather than a round number.
   */
  bonusPull: 150,
  /**
   * Roll a copy's finish again. It can go down — a best-of would make this a
   * risk-free ratchet and the whole league would converge on platinum.
   */
  reroll: 50,
} as const;

/**
 * What this copy would pay, for the affordance on a spare.
 *
 * `assertedBy` is the copy's `edition_asserted_by`. Anything other than the
 * literal `"server"` is treated as untrusted, which is the same direction the SQL
 * errs in and the safe one: a new provenance nobody has taught this function
 * about should under-promise rather than over-promise.
 */
export function millValue(edition: Edition, assertedBy: string): number {
  return assertedBy === "server" ? MILL_BY_EDITION[edition] : MILL_CLIENT_FLAT;
}

/** Rarest first, so a shop list reads the way the ladder does. */
export const MILL_LADDER: { edition: Edition; value: number }[] = EDITION_ORDER.map((edition) => ({
  edition,
  value: MILL_BY_EDITION[edition],
}));
