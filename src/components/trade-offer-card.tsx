import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { editionLabel, editionStyle, toEdition } from "@/lib/card-edition";
import type { ImageUrlSet } from "@/lib/media";
import { SECRET_RARITY } from "@/lib/secret-cards";
import { secretTierStyle } from "@/lib/secret-rarity";
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
  const width = TILE_WIDTH[size];
  const big = size === "lg";
  const roster = item.kind === "roster" ? lookup(item.eventParticipantId) : null;
  const tier = item.kind === "secret" ? secretTierStyle(item.tier) : null;
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
        rarity={item.kind === "roster" ? (roster?.rarity ?? rarityStyle("base")) : SECRET_RARITY}
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
            big ? "text-[13px]" : "text-[11px]",
          )}
        >
          {name}
        </div>
        {tier && (
          <div
            className="text-[9px] font-bold uppercase tracking-[0.2em]"
            style={{ color: tier.accent }}
          >
            {tier.label}
          </div>
        )}
        {/* Says why the art is hidden, so a face-down tile reads as a rule rather
            than as missing artwork. */}
        {concealed && (
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            not yours yet
          </div>
        )}
        {/* Any secret copy is tradeable now, single or not, so this is the only
            thing standing between somebody and giving away their only mythic.
            A marker rather than a dialog: visible, not in the way. */}
        {item.kind === "secret" && item.lastCopy && (
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-warn">
            ⚠ last copy
          </div>
        )}
        {/* Null for a standard finish — 70% of copies — so the metal only shows
            up where it means something. Same rule editionLabel applies everywhere. */}
        {finish && (
          <div
            className="text-[9px] font-bold uppercase tracking-[0.2em]"
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
        <div className="mt-0.5 text-center text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
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
}: {
  items: TradeItemView[];
  lookup: RosterCardLookup;
  size: "sm" | "lg";
}) {
  if (items.length === 0) {
    // An item whose card has since been deleted is dropped on the way out, so a
    // side can arrive empty and must still render as something.
    return <p className="text-[11px] text-muted-foreground">Nothing left on this side.</p>;
  }
  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-1", size === "lg" && "justify-center")}>
      {items.map((item) => (
        <TradeItemTile
          key={item.kind === "secret" ? item.pullId : item.copyId}
          item={item}
          lookup={lookup}
          size={size}
        />
      ))}
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
};

export function TradeOfferCard({ offer, me, nameOf, lookup, actions }: TradeOfferCardProps) {
  const iAmProposer = offer.proposerId === me;
  const theirId = iAmProposer ? offer.recipientId : offer.proposerId;
  const iGive = iAmProposer ? offer.proposerGives : offer.recipientGives;
  const iGet = iAmProposer ? offer.recipientGives : offer.proposerGives;
  const pending = offer.status === "pending";
  const accepted = offer.status === "accepted";
  const rejected =
    offer.status === "declined" || offer.status === "cancelled" || offer.status === "voided";

  // A live offer is the loudest thing on the screen: ringed, glowing, big cards.
  // A settled one is a receipt, so it stays the quiet bezel it always was.
  const size = pending ? "lg" : "sm";

  return (
    <article
      className={cn(
        "hud-bezel rounded-xl p-4",
        pending
          ? "hud-glow border-2 border-primary/70"
          : accepted
            ? "hud-glow border-2 border-success/70"
            : rejected
              ? "hud-glow border-2 border-destructive/70"
              : "border border-white/10 p-3",
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
        {!pending && (
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {offerStatusLabel(offer.status)}
          </span>
        )}
      </div>

      {/* The one-line version, which is also what the public feed shows. It is
          above the tiles rather than below because on a phone, in a garden, it is
          usually the only part anyone reads. */}
      <p className={cn("mb-3 text-muted-foreground", pending ? "text-sm" : "text-[11px]")}>
        {tradeItemsLabel(iGive)} for {tradeItemsLabel(iGet)}
      </p>

      {/* Labels sit in their own row so the cards and arrows can be perfectly
          centered vertically in the row below them. */}
      <div className={cn("mb-2 flex", pending ? "gap-2" : "gap-3")}>
        <div
          className={cn(
            "min-w-0 flex-1 text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground",
            pending ? "text-center text-[10px]" : "text-left",
          )}
        >
          You give
        </div>
        <div className="shrink-0 w-8" aria-hidden />
        <div
          className={cn(
            "min-w-0 flex-1 text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground",
            pending ? "text-center text-[10px]" : "text-left",
          )}
        >
          You get
        </div>
      </div>

      <div className={cn("flex items-center", pending ? "gap-2" : "gap-3")}>
        <div className="min-w-0 flex-1">
          <CardStrip items={iGive} lookup={lookup} size={size} />
        </div>
        <div
          className="shrink-0 flex flex-col items-center justify-center text-primary"
          aria-hidden
        >
          <ArrowRight
            className={cn(
              "drop-shadow-[0_0_10px_oklch(0.82_0.14_210/60%)]",
              pending ? "h-6 w-6" : "h-4 w-4 text-muted-foreground",
            )}
          />
          <ArrowLeft
            className={cn(
              "drop-shadow-[0_0_10px_oklch(0.82_0.14_210/60%)]",
              pending ? "h-6 w-6" : "h-4 w-4 text-muted-foreground",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <CardStrip items={iGet} lookup={lookup} size={size} />
        </div>
      </div>

      {actions && (
        <div
          className={cn("mt-4 flex flex-wrap gap-2", pending ? "justify-center" : "justify-start")}
        >
          {actions}
        </div>
      )}
    </article>
  );
}
