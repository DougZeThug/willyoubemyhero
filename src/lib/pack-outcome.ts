// What a slot in the pack means to the person turning it over.
//
// The pack used to answer this in two places with two vocabularies: a roster
// card had a "hit" slot and a NEW/×N ribbon, a secret had a duplicate flag and
// a shimmer. Now that any slot can be either kind, and a duplicate can be a
// better copy than the one you hold, the question is the same for every card —
// is this new to me, is it better than mine, or is it just another one — and
// it is answered here, once, in a form a test can exhaust.
import { editionCelebrates, editionLabel, editionRank, editionStyle, toEdition } from "./card-edition"; // prettier-ignore
import type { Rarity } from "./card-rarity";
import { secretTierCelebrates, secretTierLabel, secretTierRank, secretTierStyle } from "./secret-rarity"; // prettier-ignore
import type { PackSlot } from "./pack";

/**
 * `new` — no copy held before this pack. `upgrade` — a duplicate whose finish
 * or level strictly beats the best copy held before. `duplicate` — another one.
 */
export type PackOutcome = "new" | "upgrade" | "duplicate";

/**
 * Which burst, if any, a card earns as it lands.
 *
 * `tier` is the confetti a champion, a podium or a good finish already fires —
 * the tier and the finish are facts about the card and stay loud whatever the
 * collection held. `secret` is a new secret's framed shot from the corners.
 * `upgrade` is the new shape for a rung climbed. `quiet` is a plain duplicate:
 * a wink, not a parade.
 */
export type Celebration = "tier" | "secret" | "upgrade" | "quiet";

/** Hold on the glowing edge before a card worth waiting for lands. */
export const PEEK_MS = 900;
/** A secret holds longer. It is the only card here nobody has seen. */
export const SECRET_PEEK_MS = 1600;
/** Where in that hold the riser starts, so it lands on the chime's bottom note. */
export const SECRET_RISER_AT_MS = 700;

/**
 * What the collection held before this pack, for a roster slot.
 *
 * The server answers for a member off its own ledger. A guest's collection is
 * the phone's, so the route snapshots it at the tear and hands it in here; the
 * server's answer wins when both exist, because it is the one the vault will
 * agree with tomorrow.
 */
export type LocalBefore = { heldBefore: number; editionBefore?: string | null };

export function rosterOutcome(args: {
  heldBefore: number | null;
  editionBefore: string | null | undefined;
  edition: string | null;
}): PackOutcome {
  const { heldBefore, editionBefore, edition } = args;
  // Unknown is quiet. Calling it NEW would stamp a confident wrong answer on a
  // card that might be a third copy; "duplicate" says nothing the ribbon will
  // print, because the caller also has no count to print beside it.
  if (heldBefore == null) return "duplicate";
  if (heldBefore <= 0) return "new";
  // A finish the server has not decided cannot beat anything. The rung it is
  // measured against is what you already own — standard when the copy carries
  // no finish, which is 70% of them.
  if (edition == null) return "duplicate";
  return editionRank(edition) < editionRank(editionBefore ?? "standard") ? "upgrade" : "duplicate";
}

export function secretOutcome(args: {
  duplicate: boolean;
  tierBefore: string | null;
  tier: string;
}): PackOutcome {
  const { duplicate, tierBefore, tier } = args;
  if (!duplicate) return "new";
  return secretTierRank(tier) < secretTierRank(tierBefore) ? "upgrade" : "duplicate";
}

/** One answer for either kind of slot. */
export function slotOutcome(slot: PackSlot, local?: LocalBefore | null): PackOutcome {
  if (slot.kind === "secret") {
    return secretOutcome({ duplicate: slot.duplicate, tierBefore: slot.tierBefore, tier: slot.card.tier }); // prettier-ignore
  }
  return rosterOutcome({
    heldBefore: slot.heldBefore ?? local?.heldBefore ?? null,
    editionBefore: slot.heldBefore != null ? slot.editionBefore : local?.editionBefore,
    edition: slot.edition,
  });
}

/**
 * Copies held once this pull lands, this one included — the ribbon's number.
 * Null when nobody can say, in which case the ribbon should not render at all.
 */
export function copiesAfter(slot: PackSlot, local?: LocalBefore | null): number | null {
  if (slot.kind === "secret") return null;
  const before = slot.heldBefore ?? local?.heldBefore ?? null;
  return before == null ? null : before + 1;
}

/**
 * How long the card sits on its glowing edge before it turns, or null for no
 * hold at all.
 *
 * The pause is the whole trick, and it is spent only on a card worth the
 * wait: every secret, and any roster card that is new or better than yours. A
 * plain duplicate turns straight over — staring at a pulsing card while your
 * friends look at theirs is a tax.
 */
export function peekMs(slot: PackSlot, outcome: PackOutcome): number | null {
  if (slot.kind === "secret") return SECRET_PEEK_MS;
  return outcome === "duplicate" ? null : PEEK_MS;
}

/**
 * Which burst the landing earns.
 *
 * The tier's own celebration comes first: a champion is a champion in every
 * collection, and a platinum on a base card is the whole point of the finish
 * ladder. Only when the card itself is not a party does the collection get a
 * say — and then an upgrade is the louder of the two answers left, because it
 * is the one the person did not have yesterday.
 */
export function celebrationFor(args: {
  slot: PackSlot;
  outcome: PackOutcome;
  tier: Rarity["tier"];
}): Celebration {
  const { slot, outcome, tier } = args;
  if (slot.kind === "secret") {
    if (outcome === "new") return "secret";
    if (secretTierCelebrates(slot.card.tier)) return "tier";
    return outcome === "upgrade" ? "upgrade" : "quiet";
  }
  const finish = slot.edition;
  if (tier === "champion" || tier === "podium" || (finish != null && editionCelebrates(finish))) {
    return "tier";
  }
  if (outcome === "upgrade") return "upgrade";
  return "quiet";
}

/**
 * What the ribbon says on an upgrade, and in which metal: the NEW rung, never
 * the one it beat. Null when there is nothing to name — a roster card whose
 * finish is unknown cannot have upgraded anything.
 */
export function upgradeLabel(slot: PackSlot): { label: string; accent: string } | null {
  if (slot.kind === "secret") {
    return {
      label: secretTierLabel(slot.card.tier),
      accent: secretTierStyle(slot.card.tier).accent,
    };
  }
  const label = editionLabel(slot.edition);
  if (!label) return null;
  return { label, accent: editionStyle(toEdition(slot.edition)).accent };
}
