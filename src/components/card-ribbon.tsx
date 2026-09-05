import { IdCard, Sparkles } from "lucide-react";
import { cardBadge, editionOddsLabel, type Edition } from "@/lib/card-edition";
import { TIER_REASON, type Rarity } from "@/lib/card-rarity";

/**
 * The one badge saying what this card is.
 *
 * A standard finish reads exactly as the tier always did — tier word, reason
 * under it, in the tier colour. The label alone never said what it meant:
 * "Station King" is only a flex if you know it is the fastest split at a station,
 * so the reason rides along underneath — everywhere but a phone, where the pill
 * shrinks to the label and the reason would be a third line of chrome above a
 * card that has none of the screen left.
 *
 * A special finish takes the headline in its own metal and demotes the tier off
 * the line beneath, swapping the card glyph for sparkles, because a finish is
 * luck rather than something somebody did on the course. That rule lives in
 * `cardBadge` so every render site drops the demoted tier at once.
 *
 * COLOUR COMES OFF `--tier` / `--edn`, which an ancestor sets. Both the details
 * page and the full-screen viewer do; anything else mounting this has to, or the
 * pill draws in whatever the last screen left behind.
 */
export function CardRibbon({ rarity, edition }: { rarity: Rarity; edition: Edition }) {
  const badge = cardBadge(
    { label: rarity.label, reason: TIER_REASON[rarity.tier] ?? "", accent: rarity.accent },
    edition,
  );
  // The tier and the finish keep separate custom properties on purpose — two
  // axes, never merged — so the ribbon picks whichever one it is wearing.
  const c = badge.isEdition ? "var(--edn)" : "var(--tier)";
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-full border py-1 pl-2.5 pr-3 sm:py-1.5 sm:pl-3 sm:pr-3.5"
      style={{
        borderColor: `color-mix(in oklab, ${c} 45%, transparent)`,
        background: `color-mix(in oklab, ${c} 10%, transparent)`,
        boxShadow: `0 0 24px -8px ${c}`,
      }}
    >
      {badge.isEdition ? (
        <Sparkles className="h-4 w-4 shrink-0" style={{ color: c }} />
      ) : (
        <IdCard className="h-4 w-4 shrink-0" style={{ color: c }} />
      )}
      <div className="min-w-0 leading-tight">
        <div
          className="font-display truncate text-badge font-black uppercase tracking-[0.08em]"
          style={{ color: c }}
        >
          {badge.headline}
        </div>
        {/* On a finish this is the pull rate and nothing else — the tier is not
            repeated under its own metal. */}
        <div className="hidden truncate text-meta font-semibold text-muted-foreground sm:block">
          {badge.isEdition ? (editionOddsLabel(edition) ?? "") : badge.sub}
        </div>
      </div>
    </div>
  );
}
