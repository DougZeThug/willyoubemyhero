import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HoloCard } from "@/components/holo-card";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { secretFoil, type OwnedSecret } from "@/lib/secret-cards";
import { packedByLabel } from "@/lib/card-pulls";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack } from "@/hooks/use-photo-urls";
import { urlFromSet } from "@/lib/media.functions";

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
  card,
  onOpenChange,
}: {
  card: OwnedSecret | null;
  onOpenChange: (open: boolean) => void;
}) {
  const rarity = secretFoil(card?.foil);
  // Secrets wear the same deck back as every other card — these are universal
  // backs, so the per-card back_path is deliberately not read here.
  const { event } = useEventBundle();
  const universalBack = useEventCardBack(event?.id ?? null);
  const backUrl = urlFromSet(universalBack.data?.urls) ? universalBack.data!.urls : null;

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
              <HoloCard
                frontUrl={card.artUrl}
                backUrl={backUrl}
                name={card.name}
                rarity={rarity}
                cacheKey={card.id}
                tilt="hero"
                backContent={
                  <SecretBackPanel
                    card={card}
                    rarity={rarity}
                    pulledOn={card.firstPulledOn}
                    size="large"
                  />
                }
              />
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
