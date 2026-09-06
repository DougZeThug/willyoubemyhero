import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { editionLabel, editionStyle, toEdition } from "@/lib/card-edition";
import type { ImageUrlSet } from "@/lib/media";
import { secretFoil } from "@/lib/secret-cards";
import { secretTierStyle } from "@/lib/secret-rarity";
import { LevelPips } from "@/components/level-pips";
import { SetChip } from "@/components/set-chip";
import { useSecretCollections } from "@/hooks/use-secret-collections";
import { offerStatusLabel, tradeItemsLabel, type TradeItemView, type TradeOfferView } from "@/lib/trades"; // prettier-ignore
import { cn } from "@/lib/utils";

/** Everything the card needs to turn an event_participant_id into a face. */
export type RosterCardLookup = (eventParticipantId: string) => {
  name: string;
  /** Whatever HoloCard takes — a srcset from useEventCardUrls, or a bare url. */
  frontUrl: ImageUrlSet | string | null;
  rarity: Rarity;
};

export type TradeItemTileProps = {
  item: TradeItemView;
  lookup: RosterCardLookup;
  /** Rendered as a control rather than a picture. */
  onClick?: () => void;
  selected?: boolean;
  /** Rendered dimmed with this caption instead of as a control. */
  blockedLabel?: string;
  /**
   * `sm` is the picker strip, where eight of these live side by side. `lg` is a
   * live offer, which is the loudest thing on the screen and gets a card you can
   * actually read across a garden.
   */
  size?: "sm" | "lg";
  /**
   * Render face-down against the universal deck back instead of showing the art.
   *
   * Used for a counterparty's cards you have never pulled: the name and tier stay
   * readable — you cannot judge an offer otherwise — but the art is not spoiled
   * by scrolling somebody else's spares.
   */
  concealed?: boolean;
  /** The event's universal back, for `concealed`. Falls back to the sealed pack face. */
  backUrl?: ImageUrlSet | string | null;
};

const TILE_WIDTH: Record<"sm" | "lg", string> = {
  sm: "w-[84px]",
  lg: "w-[110px]",
};

/**
 * One card on the table.
 *
 * A roster card renders as itself, because it is public and everybody already
 * knows what it looks like. A secret renders its art and the level of THIS COPY
 * — which is the whole reason a staked secret is shown at all: "a secret card"
 * is not something anyone can say yes or no to.
 */
export function TradeItemTile({
  item,
  lookup,
  onClick,
  selected,
  blockedLabel,
  size = "sm",
  concealed = false,
  backUrl = null,
}: TradeItemTileProps) {
  const sets = useSecretCollections();
  const width = TILE_WIDTH[size];
  const big = size === "lg";
  const roster = item.kind === "roster" ? lookup(item.eventParticipantId) : null;
  // Two reads of the same field: the style for the word, the raw level for the
  // pips. Kept as one narrowing here rather than repeated in the JSX below.
  const level = item.kind === "secret" ? item.tier : null;
  const tier = level == null ? null : secretTierStyle(level);
  const name = item.kind === "roster" ? (roster?.name ?? "—") : item.name;

  // The finish on THIS copy, which is the thing a trade now actually moves — so
  // the tile has to show it or there is no way to tell two of your Alices apart.
  const finish = item.kind === "roster" ? editionLabel(item.edition) : null;

  const body = (
    <>
      <HoloCard
        frontUrl={item.kind === "roster" ? (roster?.frontUrl ?? null) : item.artUrl}
        backUrl={concealed ? backUrl : null}
        // Controlled at false with `faceDown`, so a concealed card shows the deck
        // back and stays there — tapping the tile stages the card, it does not
        // turn it over.
        faceDown={concealed}
        flipped={concealed ? false : undefined}
        backContent={concealed ? <SealedBack /> : undefined}
        name={name}
        // secretFoil with no foil id IS SECRET_RARITY — a trade item carries no
        // stored look — but routed through it so a legendary or mythic copy
        // picks up the glow the rest of the app gives it.
        rarity={
          item.kind === "roster"
            ? (roster?.rarity ?? rarityStyle("base"))
            : secretFoil(null, null, level)
        }
        edition={item.kind === "roster" ? item.edition : undefined}
        // Subtle in a picker strip, where eight foils at once are noise. A live
        // offer is one card a side, so it gets the real shine.
        intensity={big ? "full" : "subtle"}
        interactive={false}
      />
      <div className={cn("text-center", big ? "mt-2" : "mt-1.5")}>
        <div
          className={cn(
            "truncate font-display font-black uppercase tracking-wide",
            big ? "text-card-name" : "text-badge",
          )}
        >
          {name}
        </div>
        {tier && (
          <>
            <LevelPips tier={level} className="mt-0.5" />
            <div
              className="text-badge font-bold uppercase tracking-[0.08em]"
              style={{ color: tier.accent }}
            >
              {tier.label}
            </div>
          </>
        )}
        {/* Says why the art is hidden, so a face-down tile reads as a rule rather
            than as missing artwork. */}
        {concealed && (
          <div className="text-meta font-semibold text-muted-foreground">Not yours yet</div>
        )}
        {/* Which shelf it came off, on a screen that has no shelves.
            Never on a concealed tile, and NOT because the server withheld it —
            inside an offer it did not. `getTradeSpares` conceals a counterparty's
            unowned card, but `getMyTradeOffers` hydrates with concealment off,
            because you cannot judge an offer sight unseen. That exception is
            scoped to the card's NAME. A set is a different fact: it says which
            shelf of yours has something missing from it, which is the one thing
            the whole feature withholds. So the tile gates it here as well. */}
        {!concealed && item.kind === "secret" && (
          <SetChip collection={item.collection} sets={sets} />
        )}
        {/* Any secret copy is tradeable now, single or not, so this is the only
            thing standing between somebody and giving away their only mythic.
            A marker rather than a dialog: visible, not in the way. */}
        {item.kind === "secret" && item.lastCopy && (
          <div className="text-meta font-bold text-warn">⚠ Last copy</div>
        )}
        {/* Null for a standard finish — 70% of copies — so the metal only shows
            up where it means something. Same rule editionLabel applies everywhere. */}
        {finish && (
          <div
            className="text-badge font-bold uppercase tracking-[0.08em]"
            style={{ color: editionStyle(toEdition(item.kind === "roster" ? item.edition : null)).accent }} // prettier-ignore
          >
            {finish}
          </div>
        )}
      </div>
    </>
  );

  // Untradeable, and saying so where the card is: a card that simply vanishes
  // from the picker reads as data loss, which is what people actually report.
  if (blockedLabel) {
    return (
      <div className={cn(width, "shrink-0 opacity-40 grayscale")} aria-disabled="true">
        {body}
        <div className="mt-0.5 text-center text-meta font-semibold text-muted-foreground">
          {blockedLabel}
        </div>
      </div>
    );
  }

  if (!onClick) return <div className={cn(width, "shrink-0")}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        width,
        "shrink-0 rounded-md p-1 text-left transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-white/[0.04]",
      )}
    >
      {body}
    </button>
  );
}

function CardStrip({
  items,
  lookup,
  size,
  conceal = false,
  backUrl = null,
}: {
  items: TradeItemView[];
  lookup: RosterCardLookup;
  size: "sm" | "lg";
  /** Hide the art on anything in this strip the viewer does not already hold. */
  conceal?: boolean;
  backUrl?: ImageUrlSet | string | null;
}) {
  if (items.length === 0) {
    // An item whose card has since been deleted is dropped on the way out, so a
    // side can arrive empty and must still render as something.
    return <p className="text-meta text-muted-foreground">Nothing left on this side.</p>;
  }
  return (
    <div
      className={cn(
        "flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-1 pb-1",
        // Centred by margin rather than by `justify-center`, which on an
        // OVERFLOWING flex row pushes the first item off the left edge and out of
        // scroll reach entirely — exactly the four-card side this exists for.
        // And only from `sm` up: stacked, a centred row of cards under a
        // left-aligned label reads as two unrelated things.
        size === "lg" && "sm:mx-auto sm:w-fit sm:max-w-full",
      )}
    >
      {items.map((item) => (
        <div key={item.kind === "secret" ? item.pullId : item.copyId} className="snap-start">
          <TradeItemTile
            item={item}
            lookup={lookup}
            size={size}
            concealed={conceal && item.viewerOwns === false}
            backUrl={backUrl}
          />
        </div>
      ))}
    </div>
  );
}

function SideLabel({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mb-1 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground",
        // Centred over a centred row of cards, left over a left-aligned one.
        // Stacked, both sides start at the same edge whatever the size.
        pending ? "text-left sm:text-center" : "text-left",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The direction of travel, as one node restyled by breakpoint rather than two
 * swapped ones.
 *
 * Stacked, a pair of left/right arrows between two full-width rows points at
 * nothing; a rule across the gap with a down arrow in it is what "and then"
 * looks like in a column. Still `aria-hidden` — the two labelled sections carry
 * the meaning now.
 */
function Exchange({ pending }: { pending: boolean }) {
  const size = pending ? "h-6 w-6" : "h-4 w-4 text-muted-foreground";
  return (
    <div aria-hidden className="flex shrink-0 items-center gap-2 text-primary sm:flex-col sm:gap-0">
      <span className="h-px flex-1 bg-white/10 sm:hidden" />
      <ArrowDown className={cn(size, "sm:hidden")} />
      <ArrowRight className={cn(size, "hidden sm:block")} />
      <ArrowLeft className={cn(size, "hidden sm:block")} />
      <span className="h-px flex-1 bg-white/10 sm:hidden" />
    </div>
  );
}

export type TradeOfferCardProps = {
  offer: TradeOfferView;
  /** The viewer's participant id, which decides which side reads as "you". */
  me: string;
  nameOf: (participantId: string) => string;
  lookup: RosterCardLookup;
  /** Accept/decline/cancel buttons. Omitted for a settled offer. */
  actions?: ReactNode;
  /** The event's universal back, used to conceal art on the "you get" side. */
  backUrl?: ImageUrlSet | string | null;
  /**
   * Just sent from the builder, so it can be found in an outbox of four.
   *
   * A ring in the success colour rather than a bloom (§15), and deliberately a
   * different colour from the pending ring below it: "this is the one you just
   * made" and "this is live" are two different claims about the same card. The
   * words half is the toast the route raises; this is only the marker.
   */
  highlighted?: boolean;
};

export function TradeOfferCard({
  offer,
  me,
  nameOf,
  lookup,
  actions,
  backUrl = null,
  highlighted = false,
}: TradeOfferCardProps) {
  const iAmProposer = offer.proposerId === me;
  const theirId = iAmProposer ? offer.recipientId : offer.proposerId;
  const iGive = iAmProposer ? offer.proposerGives : offer.recipientGives;
  const iGet = iAmProposer ? offer.recipientGives : offer.proposerGives;
  const pending = offer.status === "pending";
  const accepted = offer.status === "accepted";
  const rejected =
    offer.status === "declined" || offer.status === "cancelled" || offer.status === "voided";

  // A live offer is the loudest thing on the screen: ringed, big cards. A
  // settled one is a receipt.
  const size = pending ? "lg" : "sm";

  return (
    <article
      data-highlighted={highlighted ? "true" : undefined}
      className={cn(
        "surface-panel rounded-xl border p-4",
        // A ring, not a bloom (§15). All three states used to glow, and all
        // three used hud-glow — which is the cyan --glow-primary — so an
        // accepted offer and a declined one bloomed the same colour as each
        // other and disagreed with their own borders. The status now lives in
        // the chip below, which is the only thing on this card that is coloured
        // by it.
        pending && "ring-2 ring-primary/50",
        highlighted && "ring-2 ring-success",
        // The tighter padding a status outside the known five would have got
        // before, kept rather than quietly widened.
        !pending && !accepted && !rejected && "p-3",
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3
          className={cn(
            "min-w-0 truncate font-display font-black uppercase tracking-wide",
            pending ? "text-xl" : "text-sm",
          )}
        >
          {iAmProposer ? `You → ${nameOf(theirId)}` : `${nameOf(theirId)} → You`}
        </h3>
        {/* The status, and now the only thing wearing its colour. A settled
            offer is still legible in one glance, without a bloom the size of
            the card behind it. */}
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-label font-bold uppercase tracking-[0.08em]",
            pending
              ? "border-primary/50 bg-primary/10 text-primary"
              : accepted
                ? "border-success/50 bg-success/10 text-success"
                : rejected
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-white/15 text-muted-foreground",
          )}
        >
          {offerStatusLabel(offer.status)}
        </span>
      </div>

      {/* The one-line version, which is also what the public feed shows. It is
          above the tiles rather than below because on a phone, in a garden, it is
          usually the only part anyone reads. */}
      <p className={cn("mb-3 text-muted-foreground", pending ? "text-sm" : "text-meta")}>
        {tradeItemsLabel(iGive)} for {tradeItemsLabel(iGet)}
      </p>

      {/* Stacked on a phone, side by side from `sm` up (§10). Two 139px columns
          at 390 meant a second card on either side scrolled out of view, and the
          labels had to live in their own row above so the columns could line up.
          Each side owns its label now, which is also what gives the two halves an
          accessible name — the arrows never had one. */}
      <div className={cn("flex flex-col sm:flex-row sm:items-center", pending ? "gap-2" : "gap-3")}>
        <section aria-label="You give" className="min-w-0 flex-1">
          <SideLabel pending={pending}>You give</SideLabel>
          <CardStrip items={iGive} lookup={lookup} size={size} />
        </section>
        <Exchange pending={pending} />
        <section aria-label="You get" className="min-w-0 flex-1">
          <SideLabel pending={pending}>You get</SideLabel>
          {/* Their side only: what you are being offered can include art you have
              never pulled, and an offer should not be a way to see it. */}
          <CardStrip items={iGet} lookup={lookup} size={size} conceal backUrl={backUrl} />
        </section>
      </div>

      {actions && (
        <div
          className={cn(
            // Stacked at 390: a 56px primary and a 44px quiet control side by
            // side leave neither enough width to read.
            "mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap",
            pending ? "sm:justify-center" : "sm:justify-start",
          )}
        >
          {actions}
        </div>
      )}
    </article>
  );
}
