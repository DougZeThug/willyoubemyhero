import { PackCardBack } from "@/components/pack-card-back";
import type { ImageUrlSet } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * A roster card nobody on this device has packed yet.
 *
 * The vault used to print all eighteen fronts to anyone who scrolled past, which
 * spent the whole set before a single pack was ripped — the tick in the corner
 * was the only thing separating a card you earned from one you walked past. This
 * is what stands in its place until `card_pulls` says otherwise.
 *
 * Wears the *event's* back, never the player's: `useEventCardBack` is the hook
 * for that, and the long note on it explains why `useEventCardUrls` would print
 * the card's own back here and give away the reveal on an event where people
 * have their own.
 *
 * Deliberately not `HoloCard`, for the same two reasons `PackCardBack` gives:
 * eighteen tilt controllers and eighteen blend-mode foil stacks for cards nobody
 * can touch, and `HoloCard` puts `role="button" aria-pressed` on anything with a
 * back — which is the selector the e2e suite finds the pack stand with.
 */
export function LockedCard({
  name,
  back,
  className,
}: {
  name: string;
  /** The event's universal back. Null falls through to PackCardBack's SealedBack. */
  back: ImageUrlSet | null;
  className?: string;
}) {
  return (
    // The ratio lives here rather than in PackCardBack, which is `h-full w-full`
    // because the pack ceremony sizes it from the deck it is flying out of.
    <div
      className={cn("aspect-[5/7] w-full overflow-hidden rounded-xl border border-white/10", className)} // prettier-ignore
      role="img"
      aria-label={`${name} — not packed yet`}
    >
      <PackCardBack art={back} />
    </div>
  );
}
