import { PackCardBack } from "@/components/pack-card-back";
import { rarityStyle } from "@/lib/card-rarity";
import type { ImageUrlSet } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * The bezel a face-down slot wears, and the tier every other surface should
 * dress a locked card in — the filmstrip chip on the card page, most of all.
 *
 * Base, always. A locked slot tinted gold would announce the tier of the card it
 * is hiding, which is the whole thing being withheld. It lives here rather than
 * beside each caller because it belongs to the locked slot, not to the screen
 * drawing one: two module constants with the same name in two routes is one
 * edit away from a vault that hides tiers and a card page that does not.
 */
export const LOCKED_RARITY = rarityStyle("base");

/**
 * A roster card this device has never packed, face-down.
 *
 * Opening a pack is the only way a card arrives — that has been true of the
 * collection since collect-on-sight was removed, but the art never caught up and
 * the vault kept printing all eighteen faces to anyone who scrolled past. This is
 * the slot that shows instead: the event's back, and nothing else about the card.
 *
 * Deliberately not `HoloCard`, for the reason `pack-card-back.tsx` already gives
 * in its own comment — no tilt controller and no blend-mode foil stack for
 * eighteen cards nobody can turn over, and `HoloCard` puts
 * `role="button" aria-pressed` on anything with a back, which is the exact
 * selector the e2e suite uses to find the card on the pack stand.
 *
 * `PackCardBack` is `h-full w-full`, so the card's shape has to come from here.
 */
export function LockedCard({
  back,
  name,
  className,
}: {
  /** The *event's* universal back, never the player's own — that one is the reveal. */
  back: ImageUrlSet | null;
  name: string;
  className?: string;
}) {
  return (
    <div
      // One image to a screen reader rather than a container of decoration, so a
      // locked slot announces which player it belongs to and that it is shut.
      role="img"
      aria-label={`${name} — not packed yet`}
      className={cn(
        "relative aspect-[5/7] w-full overflow-hidden rounded-xl border shadow-2xl",
        className,
      )}
      // Not a prop. The only correct value is the neutral one, so a caller cannot
      // be handed the chance to pass the tier it is supposed to be hiding.
      style={{
        borderColor: LOCKED_RARITY.border,
        boxShadow: `0 0 28px -6px ${LOCKED_RARITY.border}`,
      }}
    >
      <PackCardBack art={back} />
    </div>
  );
}
