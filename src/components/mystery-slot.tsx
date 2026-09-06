import { LOCKED_RARITY } from "@/components/locked-card";
import { urlFromSet, type ImageUrlSet } from "@/lib/media";

/**
 * The horizon at the end of an open set shelf.
 *
 * One face-down tile saying a set has more in it, and nothing else. This is the
 * single exception to the rule the rest of the secret feature is built on — no
 * denominator, no silhouettes, no empty slots — and it is only an exception in
 * this exact shape: ONE tile, whether one card is left or twenty. It carries no
 * number, it is not a card, and it is not a link to anything.
 *
 * A sibling of LockedCard rather than a variant of it, because the two withhold
 * different things. A locked slot knows which player it is hiding and says so; a
 * mystery slot has nothing to name, which is the whole point. It borrows that
 * file's LOCKED_RARITY for the same reason that constant exists: the only correct
 * colour here is the neutral one, and two copies of "the neutral one" is one edit
 * away from a slot that starts hinting at what is under it.
 *
 * Dashed rather than solid, and no bloom. A locked roster slot is a specific card
 * you have not packed; this is a space where cards may or may not be. The border
 * is the difference between "shut" and "unwritten".
 */
export function MysterySlot({ back }: { back: ImageUrlSet | null }) {
  const url = urlFromSet(back, "thumb");
  return (
    <div className="flex flex-col gap-2">
      <div
        // One image with one name, like the locked slot next door — so a shelf
        // read aloud ends the same way it looks: there is more here, and nothing
        // about how much.
        role="img"
        aria-label="Unknown cards remain"
        className="relative aspect-[5/7] w-full overflow-hidden rounded-xl border border-dashed"
        style={{ borderColor: `color-mix(in oklab, ${LOCKED_RARITY.border} 45%, transparent)` }}
      >
        {/* The event's back where there is one, and bare foil where there is
            not — deliberately NOT PackCardBack's SealedBack, which is the branded
            fallback and has "Will YOU Be My Hero? / Draft Combine" written across
            the middle of it. Under the "?" those words fight for the same space
            and neither wins. A slot has nothing to announce; it only has to read
            as a card, face down.

            The thumb rendition, like every other face-down slot in this grid: a
            picture the eye reads as "shut" does not need 1200px. */}
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden
            draggable={false}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="wax-foil h-full w-full" aria-hidden />
        )}
        {/* Heavy enough that whatever is under it reads as texture rather than as
            a picture: this slot is a space, not a card somebody is hiding. */}
        <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="font-display text-5xl font-black leading-none text-foreground/70">
            ?
          </span>
        </div>
      </div>
      {/* aria-hidden: the tile above already says this, and a screen reader
          hearing both would get the sentence twice. */}
      <div aria-hidden className="text-center text-meta font-semibold text-muted-foreground">
        More in this set
      </div>
    </div>
  );
}
