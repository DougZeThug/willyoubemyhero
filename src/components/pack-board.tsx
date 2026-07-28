import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Link } from "@tanstack/react-router";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/sealed-back";
import { cachedCardMeta } from "@/lib/card-collection";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { cn } from "@/lib/utils";

/** Standard trading card, same default HoloCard falls back to. */
const DEFAULT_ASPECT = 5 / 7;

export type BoardCard = {
  /** The event_participant id. Doubles as HoloCard's aspect-cache key. */
  id: string;
  name: string;
  rarity: Rarity;
  frontUrl: string | null;
  backUrl: string | null;
  /** Generated stats back, shown when there is no uploaded back art. */
  backContent: ReactNode;
  /** "Packed by four" and friends. Null renders nothing. */
  packedBy: string | null;
};

/**
 * Where the pack ends up.
 *
 * Two up on a phone, with the third centred underneath. This was three across at
 * every width, so the whole pack stayed in view at once — but a third of a 390px
 * screen minus gaps comes out around 114px, smaller than the vault's own grid
 * thumbnails and far too small to be the payoff of a ceremony. Seeing all three
 * without scrolling turned out to be worth less than being able to see any of
 * them.
 *
 * Four columns spanning two each, rather than grid-cols-2: it makes the odd card
 * `col-start-2`, where it lands exactly centred at exactly the width of the two
 * above, with no calc() and no half-gap drift. Both spans release at sm:, where
 * three across is right again because the width is there.
 */
export function PackBoard({
  cards,
  revealed,
  sealedBackUrl,
  hiddenIndex,
  registerSlot,
  onOpen,
}: {
  cards: BoardCard[];
  /** Indices that have landed face-up. Anything else is still face-down. */
  revealed: number[];
  /**
   * The event's universal back, worn by every face-down card.
   *
   * Deliberately not each card's own `backUrl`. In a real deck every back is
   * identical — that uniformity is the entire reason a face-down card means
   * anything. On an event where players have their own back art, using it here
   * would print whose card it is on the side you have not turned over yet.
   */
  sealedBackUrl: string | null;
  /**
   * The card currently up on the stage. Its slot renders an empty box at the
   * right height so the board does not reflow underneath the flight.
   */
  hiddenIndex: number | null;
  /** Ref callback per slot, so the stage knows where to fly a card. */
  registerSlot: (index: number, el: HTMLElement | null) => void;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-4 items-start gap-3 sm:grid-cols-3 sm:gap-4">
      {cards.map((card, i) => {
        const isRevealed = revealed.includes(i);
        const hidden = hiddenIndex === i;
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, type: "spring", stiffness: 220, damping: 20 }}
            className={cn(
              "col-span-2 flex flex-col gap-2",
              // Only while the grid is two-up. At sm: it is an ordinary third
              // column and must let go, or it stays offset.
              i === 2 && "col-start-2",
              "sm:col-span-1 sm:col-start-auto",
            )}
          >
            <div ref={(el) => registerSlot(i, el)} className="rounded-xl">
              {hidden ? (
                // Sized from the cached aspect rather than left empty: this slot
                // is the flight's target, and a zero-height box would move the
                // rest of the board out from under a card already in the air.
                // cachedCardMeta is synchronous and primed by the time any card
                // has been dealt.
                <div
                  aria-hidden
                  className="w-full rounded-xl border border-dashed border-white/10"
                  style={{ aspectRatio: cachedCardMeta(card.id)?.aspect ?? DEFAULT_ASPECT }}
                />
              ) : isRevealed ? (
                // Uncontrolled once revealed, so it flips freely front to back.
                <HoloCard
                  frontUrl={card.frontUrl}
                  backUrl={card.backUrl}
                  name={card.name}
                  rarity={card.rarity}
                  cacheKey={card.id}
                  backContent={card.backContent}
                />
              ) : (
                // Real back art, not the wax-foil stand-in: a pack of cards
                // face-down should look like the deck it came from.
                //
                // `base` rarity, not the card's own: HoloCard paints the tier
                // colour onto the border and the outer glow, so the real one
                // would announce a gold card through the back of it.
                //
                // Real back art also makes canFlip true, which would normally arm
                // flick-to-flip. It doesn't here — both the flick and the click
                // are gated on `!onClick`, and this card has one. A face-down
                // card cannot turn itself over; only a reveal does.
                <HoloCard
                  frontUrl={card.frontUrl}
                  backUrl={sealedBackUrl}
                  name={`Card ${i + 1}`}
                  rarity={rarityStyle("base")}
                  cacheKey={card.id}
                  faceDown
                  flipped={false}
                  interactive={false}
                  backContent={<SealedBack />}
                  onClick={() => onOpen(i)}
                />
              )}
            </div>

            <AnimatePresence>
              {isRevealed && !hidden && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center"
                >
                  {/* Wrapped rather than truncated: a name cut off mid-word is a
                      poor look on the screen meant to be the payoff, and at
                      two-up there is room for two lines. The grid's items-start
                      absorbs the uneven rows. */}
                  <Link
                    to="/players/$id"
                    params={{ id: card.id }}
                    className="line-clamp-2 block font-display text-sm font-black uppercase leading-tight tracking-wide hover:text-primary sm:text-base"
                  >
                    {card.name}
                  </Link>
                  {/* accent, not border: base and dnf set border to a
                      near-transparent white so their bezel vanishes, which at
                      this size left the label all but unreadable. Same reason
                      CardBackPanel does it. */}
                  <div
                    className="text-[10px] font-bold uppercase tracking-[0.25em] sm:text-xs"
                    style={{ color: card.rarity.accent }}
                  >
                    {card.rarity.label}
                  </div>
                  {/* Muted and on its own line: the tier above is what this card
                      is, this is how many people have one. */}
                  {card.packedBy && (
                    <div className="text-[9px] font-bold uppercase leading-tight tracking-[0.2em] text-muted-foreground sm:text-[10px]">
                      {card.packedBy}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
