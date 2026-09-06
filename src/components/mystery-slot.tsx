import { PackCardBack } from "@/components/pack-card-back";
import { LOCKED_RARITY } from "@/components/locked-card";
import type { ImageUrlSet } from "@/lib/media";

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
        <PackCardBack art={back} inGrid className="opacity-40" />
        <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/45">
          <span className="font-display text-4xl font-black leading-none text-foreground/45">
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
