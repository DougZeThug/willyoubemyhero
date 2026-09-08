import { cn } from "@/lib/utils";

/**
 * Whether this pull was your first, or your Nth.
 *
 * The pack used to say nothing at all about newness for a roster card: a third
 * Bob flipped exactly like a first Bob, and the only "already yours" in the whole
 * ceremony belonged to the secret. So the one fact a collector actually wants at
 * the moment of the flip — is this a card I did not have — was the one fact the
 * screen withheld.
 *
 * A corner label rather than a caption, because the captions under the card are
 * already carrying the name, the tier, the finish and the pull count, and a fifth
 * line there is a line nobody reads standing in a garden. On the frame it is
 * attached to the card it is talking about.
 *
 * TOP LEFT, deliberately. `.card-edition-tab` owns the top-right corner on tiles,
 * and two stamps on one corner is two stamps nobody can read.
 *
 * One component for both kinds of card, because the ribbon should not know
 * where its number came from — the roster's comes from the ledger as it stood
 * when the pack was dealt and the secret's from the slot's own duplicate flag,
 * and both arrive here already resolved to "how many you now hold".
 *
 * THE THIRD WORD. A duplicate that beats the copy you hold is neither a first
 * nor just another one: it is the rung you just climbed, so the stamp names the
 * new rung in its own metal — "↑ GOLD", "↑ EPIC" — and wins over the count.
 */
export function PullRibbon({
  copies,
  upgrade = null,
  className,
}: {
  /**
   * Copies held once this pull lands, this one included. 1 is a first.
   *
   * Never a floor of zero: the card is in your hand. A caller that cannot answer
   * yet should not render the ribbon at all rather than pass 0, which would read
   * as NEW on a card that might be a duplicate. A secret passes its count from
   * the pull's own flag; a secret upgrade passes `upgrade` and any count.
   */
  copies: number;
  /** The rung this copy climbed to, in its own colour. Null for no climb. */
  upgrade?: { label: string; accent: string } | null;
  className?: string;
}) {
  const first = !upgrade && copies <= 1;
  const label = upgrade
    ? `Upgraded to ${upgrade.label} — you now hold ${copies} of this card`
    : first
      ? "New card"
      : `You now hold ${copies} of this card`;
  return (
    <span
      // One label for the whole stamp, the way LevelPips labels its row: a screen
      // reader should hear what it means, not read a glyph.
      role="img"
      aria-label={label}
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-10 select-none",
        "rounded-br-lg px-2 py-1 font-display text-label font-black uppercase leading-none tracking-[0.08em]",
        // The card's own corner, so the stamp curves with it — the same trick
        // .card-edition-tab uses for the opposite corner.
        "rounded-tl-[inherit]",
        upgrade
          ? "text-background"
          : first
            ? "bg-primary text-background"
            : // A duplicate is good news too, just quieter. Reading it in the same
              // electric cyan as a first would make every card look like a first.
              "border border-white/15 bg-background/85 text-muted-foreground backdrop-blur-sm",
        className,
      )}
      // The metal is the finish's or the level's own colour, which is not a
      // token — so it is painted rather than classed, the way the card's frame
      // paints it.
      style={upgrade ? { background: upgrade.accent } : undefined}
    >
      <span aria-hidden>{upgrade ? `↑ ${upgrade.label}` : first ? "NEW" : `×${copies}`}</span>
    </span>
  );
}
