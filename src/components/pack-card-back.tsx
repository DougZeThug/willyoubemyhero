import { Sparkles } from "lucide-react";
import { urlFromSet, type ImageUrlSet } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * The generic back, drawn in CSS.
 *
 * The designed fallback, not a spinner: an event with no uploaded back gets this
 * permanently and it still looks like a pack of cards. Lived in pack-stand.tsx
 * until the opening ceremony needed the same face — the deck it hands over has to
 * be the card the stand is about to show, or the handoff is a visible cut.
 */
export function SealedBack() {
  return (
    <div className="wax-foil flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
      <Sparkles className="h-5 w-5 text-primary/80" />
      <div className="font-display text-label font-black uppercase tracking-[0.08em] text-primary/80">
        Will YOU Be My Hero?
      </div>
      <div className="font-display text-sm font-black uppercase leading-none text-foreground/90">
        Draft Combine
      </div>
    </div>
  );
}

/**
 * A face-down card, for the cards flying out of the pack.
 *
 * Deliberately not `HoloCard`. Three of those means three tilt controllers, three
 * blend-mode foil stacks and three pointer subtrees for cards nobody can touch,
 * during the busiest two seconds this app has — and `HoloCard` puts
 * `role="button" aria-pressed` on anything with a back, which is the exact
 * selector the e2e suite uses to find the card on the stand.
 */
export function PackCardBack({
  art,
  className,
  inGrid = false,
}: {
  art: ImageUrlSet | null;
  className?: string;
  /**
   * Set by the vault's locked slots, and by nothing in the ceremony.
   *
   * A shelf holds one of these per card nobody has packed yet, and every one of
   * them was decoding the same 1200px back — a full-size image per slot for a
   * picture the eye reads as "shut" at any size (§21). In a grid this takes the
   * 320px rendition and defers anything below the fold. The pack's own cards keep
   * `large` and eager: there are three of them, they are the size of the screen,
   * and a back that pops in mid-tear is a visible seam in the one animation this
   * app is built around.
   */
  inGrid?: boolean;
}) {
  const url = urlFromSet(art, inGrid ? "thumb" : "large");
  return (
    <div className={cn("h-full w-full overflow-hidden rounded-xl", className)}>
      {url ? (
        <img
          src={url}
          alt=""
          aria-hidden
          draggable={false}
          loading={inGrid ? "lazy" : "eager"}
          className="h-full w-full object-cover"
        />
      ) : (
        <SealedBack />
      )}
    </div>
  );
}
