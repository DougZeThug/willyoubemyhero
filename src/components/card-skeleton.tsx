import { Skeleton } from "@/components/ui/skeleton";

/**
 * A card-shaped hole, for the second the vault spends deciding what it holds.
 *
 * The shelf used to paint every slot face-down and then pop the ones you own
 * open as `mine.ready` turned true (§19). That reads as a reveal you did not
 * ask for — thirteen cards flipping at once, in the wrong place, for free — and
 * it is the exact animation the pack screen exists to sell. A placeholder says
 * "not known yet" instead, which is the truth.
 *
 * Same 5:7 box and the same two caption lines as `rosterTile`, so nothing moves
 * when the real thing lands. `animate-none` puts out the primitive's 1s pulse:
 * the sweep lives on a pseudo-element (see `.skeleton-sweep` in styles.css) and
 * runs slowly enough that a grid of them does not strobe.
 *
 * `aria-hidden`, with one polite status line for the whole grid at the call
 * site — twelve "loading" announcements is worse than none.
 */
export function CardSkeleton() {
  return (
    <div aria-hidden data-testid="card-skeleton">
      <Skeleton className="skeleton-sweep aspect-[5/7] w-full animate-none rounded-xl" />
      <div className="mt-2 flex flex-col items-center gap-1.5">
        <Skeleton className="skeleton-sweep h-3.5 w-2/3 animate-none rounded" />
        <Skeleton className="skeleton-sweep h-3 w-1/3 animate-none rounded" />
      </div>
    </div>
  );
}
