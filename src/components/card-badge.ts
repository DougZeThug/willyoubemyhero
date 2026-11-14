import { cardBadge, editionOddsLabel, type Edition } from "@/lib/card-edition";
import { TIER_REASON, type Rarity } from "@/lib/card-rarity";

/**
 * What the ribbon on the card page and the headline row on the generated back
 * both print. `subLine` is the line under the headline: on a finish it is the pull
 * rate and nothing else, otherwise the tier's reason. `tierReason` is for the back,
 * which prints the demoted tier on its own row when a finish took the headline.
 */
export function badgeFor(rarity: Rarity, edition?: Edition) {
  const tierReason = TIER_REASON[rarity.tier] ?? "";
  const badge = cardBadge(
    { label: rarity.label, reason: tierReason, accent: rarity.accent },
    edition,
  );
  return {
    ...badge,
    tierReason,
    subLine: badge.isEdition ? (editionOddsLabel(edition) ?? "") : badge.sub,
  };
}
