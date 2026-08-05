import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HoloCard } from "@/components/holo-card";
import { ZoomPanFrame } from "@/components/zoom-pan-frame";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { secretFoil, type OwnedSecret } from "@/lib/secret-cards";
import { stepIndex } from "@/lib/zoom";
import { packedByLabel } from "@/lib/card-pulls";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack } from "@/hooks/use-photo-urls";
import { urlFromSet } from "@/lib/media";

/**
 * One secret card, big.
 *
 * A dialog rather than a route on purpose. players.$id.tsx is keyed on an
 * event_participant id and could never address one of these, and a URL is
 * shareable — which is the one thing a secret card must not be. Someone can still
 * show you their phone; that is the intended and only channel.
 *
 * No reactions, no comments and no share button. The only number here beyond
 * your own is how many *people* have found this card — never how many cards
 * exist, which is the thing the whole feature withholds.
 */
export function SecretCardSheet({
  cards,
  index,
  onIndexChange,
  onOpenChange,
}: {
  /** Every secret this device holds, so one can be swiped to the next. */
  cards: OwnedSecret[];
  /** Which one is open, or null for closed. */
  index: number | null;
  onIndexChange: (next: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const card = index == null ? null : (cards[index] ?? null);
  const rarity = secretFoil(card?.foil, card?.borderFx);
  const [flipped, setFlipped] = useState(false);

  // A new card always lands face up, however the last one was left.
  useEffect(() => setFlipped(false), [card?.id]);

  // Secrets wear the same deck back as every other card — these are universal
  // backs, so the per-card back_path is deliberately not read here.
  const { event } = useEventBundle();
  const universalBack = useEventCardBack(event?.id ?? null);
  const backUrl = urlFromSet(universalBack.data?.urls) ? universalBack.data!.urls : null;

  const go = (dir: -1 | 1) => {
    if (index == null || cards.length < 2) return;
    onIndexChange(stepIndex(index, cards.length, dir));
  };

  return (
    <Dialog open={!!card} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-[92vw] border-white/10 bg-background/95 p-4 sm:max-w-md md:max-w-lg md:p-6">
        {card && (
          <>
            <DialogTitle className="font-display text-2xl font-black uppercase leading-none sm:text-3xl">
              {card.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              A secret card you pulled from a pack.
            </DialogDescription>

            <div className="mx-auto w-full max-w-[320px] sm:max-w-[420px]">
              <ZoomPanFrame
                onSwipe={go}
                onTap={() => setFlipped((f) => !f)}
                canNavigate={cards.length > 1}
                prevLabel="Previous secret"
                nextLabel="Next secret"
                position={index != null ? `${index + 1} / ${cards.length}` : undefined}
                hint="Pinch to zoom · tap to flip"
              >
                {({ zoomed }) => (
                  <HoloCard
                    frontUrl={card.artUrl}
                    backUrl={backUrl}
                    name={card.name}
                    rarity={rarity}
                    tilt="hero"
                    flipped={flipped}
                    onFlippedChange={setFlipped}
                    interactive={!zoomed}
                    flickToFlip={false}
                    backContent={
                      <SecretBackPanel
                        card={card}
                        rarity={rarity}
                        pulledOn={card.firstPulledOn}
                        size="large"
                      />
                    }
                  />
                )}
              </ZoomPanFrame>
            </div>

            {card.flavour && (
              <p className="text-center text-sm italic text-muted-foreground sm:text-base">
                &ldquo;{card.flavour}&rdquo;
              </p>
            )}

            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
              <span>Pulled {card.firstPulledOn}</span>
              {card.count > 1 && <span style={{ color: rarity.accent }}>Pulled ×{card.count}</span>}
            </div>

            {packedByLabel(card.ownerCount) && (
              <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                {card.ownerCount === 1
                  ? "You are the only one who has found this"
                  : packedByLabel(card.ownerCount)}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
