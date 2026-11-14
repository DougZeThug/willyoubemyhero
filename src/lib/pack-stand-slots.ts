import type { StandSlot } from "./stand-view";
import { rarityStyle, type rarityMap } from "@/lib/card-rarity";
import { toEdition } from "@/lib/card-edition";
import { MILL_BY_EDITION, secretSellValue } from "@/lib/dust";
import { rosterHeldNow, secretHeldNow, type PackSlot } from "@/lib/pack";
import { copiesAfter, slotOutcome, type LocalBefore } from "@/lib/pack-outcome";
import { secretFoil } from "@/lib/secret-cards";

/** A slot sold from the summary: what it fetched, and the count it left behind. */
export type SoldSlot = { awarded: number; copies: number | null };

/** A holdings query, reduced to what the "held now" answer depends on. */
type Holding<T> = { data: T; fetching: boolean; errored: boolean };

/**
 * Every slot, resolved for the stand and the summary.
 *
 * This is the one place the pack's numbers are decided: the tier from the
 * bundle, the finish from the deal, the outcome from what was held before,
 * the count for the ribbon, and what a spare is worth — the last two gated
 * exactly as they always were: duplicates only, members only, silent while
 * the commissioner has dust switched off (`pricing`).
 */
export function buildStandSlots(input: {
  slots: PackSlot[] | null;
  participants: NonNullable<StandSlot["ep"]>[];
  rarities: ReturnType<typeof rarityMap>;
  localBefore: Record<string, LocalBefore>;
  mySecrets: Holding<readonly { id: string; count: number }[] | undefined>;
  mySpares: Holding<Parameters<typeof rosterHeldNow>[0]["spares"]>;
  sold: Record<number, SoldSlot>;
  pricing: boolean;
}): StandSlot[] {
  const { slots, participants, rarities, localBefore, mySecrets, mySpares, sold, pricing } = input;
  return (slots ?? []).map((slot, i) => {
    if (slot.kind === "secret") {
      const outcome = slotOutcome(slot);
      // The ribbon's count is about THIS pull, so it never falls below two for a
      // duplicate — "by definition never your first" — however the vault has
      // moved since. PullRibbon reads one as NEW, which a sale or a trade later
      // the same day must not turn a duplicate into. What the vault holds NOW is
      // `held` below, and it is that, not this, the dialog and the receipt quote.
      // Sold from this screen: the count as it stood the moment the sale
      // landed. Not "the server's count minus one" — the sale invalidates
      // getMySecrets, so the refetch already has the copy gone and the
      // subtraction would count it twice.
      const mine = mySecrets.data?.find((c) => c.id === slot.id)?.count ?? 0;
      const copies = sold[i] ? sold[i].copies : !slot.duplicate ? 1 : Math.max(2, mine);
      // Not while the query is in the air: `getMySecrets` is invalidated by the
      // deal, so until it lands the cached count may predate it.
      const held = sold[i]
        ? null
        : secretHeldNow({
            cards: mySecrets.data,
            slotId: slot.id,
            fetching: mySecrets.fetching,
            errored: mySecrets.errored,
          });
      return {
        slot,
        rarity: secretFoil(slot.card.foil, slot.card.borderFx, slot.card.tier),
        edition: null,
        outcome,
        copies,
        held,
        sellValue:
          pricing && slot.duplicate && !(i in sold) ? secretSellValue(slot.card.tier) : null,
        ep: null,
      };
    }
    const local = localBefore[slot.id];
    const outcome = slotOutcome(slot, local);
    // The ribbon's count is the collection as it stood at the deal, and is about
    // this pull. What the vault holds NOW is `held`, and it is that the dialog
    // quotes: a trade since the deal (the other phone accepting an offer) moves it.
    // Sold from this screen, the receipt is the count the sale itself read.
    const copies = sold[i] ? sold[i].copies : copiesAfter(slot, local);
    const held = sold[i]
      ? null
      : rosterHeldNow({
          spares: mySpares.data,
          slotId: slot.id,
          fetching: mySpares.fetching,
          errored: mySpares.errored,
        });
    // `MILL_BY_EDITION` rather than `millValue`, and that is safe rather than
    // optimistic: the finish is the one Postgres minted. A finish it did not
    // decide is null, and null prices nothing — no number is better than a
    // number that moves.
    const sellValue =
      pricing && !(i in sold) && (copies ?? 1) > 1 && slot.edition != null
        ? MILL_BY_EDITION[toEdition(slot.edition)]
        : null;
    return {
      slot,
      rarity: rarities.get(slot.id) ?? rarityStyle("base"),
      edition: slot.edition,
      outcome,
      copies,
      held,
      sellValue,
      ep: participants.find((p) => p.id === slot.id) ?? null,
    };
  });
}
