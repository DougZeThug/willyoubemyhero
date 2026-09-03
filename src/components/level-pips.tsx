import { SECRET_TIER_ORDER, secretTierLevel, secretTierStyle } from "@/lib/secret-rarity";
import { cn } from "@/lib/utils";

/**
 * How lucky this copy was, as a row of diamonds.
 *
 * The level is the axis the product cares most about and the weakest one on
 * screen: it was a 13px coloured word, so two cards from the same set at
 * different levels looked identical until you read the caption. Shape survives
 * where a word does not — a tile in a garden, in one hand, at arm's length.
 *
 * The unlit rungs are drawn as outlines rather than left out, because the ladder
 * position is the information: four filled diamonds mean nothing without the
 * fifth empty one next to them.
 *
 * Colour is never the only cue here — the count carries it — but the accent is
 * kept so the pips agree with the level word they sit under.
 */
export function LevelPips({
  tier,
  className,
}: {
  /** The stored level of one pull. Anything unrecognised draws a single pip. */
  tier: string | null | undefined;
  className?: string;
}) {
  const style = secretTierStyle(tier);
  const level = secretTierLevel(tier);
  const total = SECRET_TIER_ORDER.length;

  return (
    <span
      // One label for the row, not five: a screen reader should hear the level,
      // not count diamonds. Matches how the card's own sr-only line reads.
      role="img"
      aria-label={`${style.label}, ${level} of ${total}`}
      className={cn("inline-flex items-center gap-[3px] align-middle", className)}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="h-[5px] w-[5px] rotate-45 rounded-[1px]"
          style={
            i < level
              ? { background: style.accent }
              : { border: `1px solid ${style.accent}`, opacity: 0.3 }
          }
        />
      ))}
    </span>
  );
}
