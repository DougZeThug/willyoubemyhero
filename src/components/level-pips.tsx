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
  namesLevel = false,
  className,
}: {
  /** The stored level of one pull. Anything unrecognised draws a single pip. */
  tier: string | null | undefined;
  /**
   * Name the level in the pips' label, as well as counting it.
   *
   * Off by default because almost every site writes the level beside the pips
   * already, and a self-describing label there says it twice: a screen reader
   * would read "Mythic, 5 of 5" and then the very next node, "Mythic · 0.5%
   * pull". The count is what the pips add over that word, so the count is all
   * they announce. Set this where the pips are the only level cue on screen —
   * today that is the pack summary's secret slot, whose caption teaches what a
   * secret is and never names the level.
   */
  namesLevel?: boolean;
  className?: string;
}) {
  const style = secretTierStyle(tier);
  const level = secretTierLevel(tier);
  const total = SECRET_TIER_ORDER.length;

  return (
    <span
      // One label for the row, not five: a screen reader should hear the level,
      // not count diamonds.
      role="img"
      aria-label={
        namesLevel ? `${style.label}, ${level} of ${total}` : `Level ${level} of ${total}`
      }
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
