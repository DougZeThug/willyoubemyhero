import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
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
};

const TILE_WIDTH: Record<"sm" | "lg", string> = {
  sm: "w-[84px]",
  lg: "w-[132px]",
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
}: TradeItemTileProps) {
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
        backUrl={null}
        name={name}
        rarity={item.kind === "roster" ? (roster?.rarity ?? rarityStyle("base")) : SECRET_RARITY}
        edition={item.kind === "roster" ? item.edition : undefined}
        // Subtle throughout: these are thumbnails in a list, and a full-strength
        // foil on eight of them at once is noise rather than shine.
        intensity="subtle"
        interactive={false}
      />
      <div className="mt-1.5 text-center">
        <div className="truncate font-display text-[11px] font-black uppercase tracking-wide">
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
      <div className="w-[84px] shrink-0 opacity-40 grayscale" aria-disabled="true">
        {body}
        <div className="mt-0.5 text-center text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {blockedLabel}
        </div>
      </div>
    );
  }

  if (!onClick) return <div className="w-[84px] shrink-0">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "w-[84px] shrink-0 rounded-md p-1 text-left transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-white/[0.04]",
      )}
    >
      {body}
    </button>
  );
}

function Side({
  label,
  items,
  lookup,
}: {
  label: string;
  items: TradeItemView[];
  lookup: RosterCardLookup;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </div>
      {items.length === 0 ? (
        // Not reachable through the RPC, which refuses an empty side — but an
        // item whose card has since been deleted is dropped on the way out, so a
        // side can arrive empty and must still render as something.
        <p className="text-[11px] text-muted-foreground">Nothing left on this side.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((item) => (
            <TradeItemTile
              key={item.kind === "secret" ? item.pullId : item.copyId}
              item={item}
              lookup={lookup}
            />
          ))}
        </div>
      )}
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

  return (
    <article className="hud-bezel rounded-lg border border-white/10 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate font-display text-sm font-black uppercase tracking-wide">
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
      <p className="mb-2.5 text-[11px] text-muted-foreground">
        {tradeItemsLabel(iGive)} for {tradeItemsLabel(iGet)}
      </p>

      <div className="flex items-start gap-3">
        <Side label="You give" items={iGive} lookup={lookup} />
        <ArrowRight className="mt-6 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Side label="You get" items={iGet} lookup={lookup} />
      </div>

      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
