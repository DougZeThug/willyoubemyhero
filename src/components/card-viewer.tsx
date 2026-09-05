import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronUp,
  GitCompareArrows,
  Handshake,
  MoreHorizontal,
  PackageOpen,
  RotateCw,
  Share2,
  Star,
  X,
} from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { LockedCard, LOCKED_RARITY } from "@/components/locked-card";
import { ZoomPanFrame } from "@/components/zoom-pan-frame";
import { CardRibbon } from "@/components/card-ribbon";
import { LevelPips } from "@/components/level-pips";
import { PresentationMode, PresentationStage } from "@/components/presentation-mode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModalSurface } from "@/hooks/use-modal-surface";
import { editionStyle, type Edition } from "@/lib/card-edition";
import { packedByLabel } from "@/lib/card-pulls";
import { playFlip } from "@/lib/card-sfx";
import { formatDay } from "@/lib/format";
import type { ImageUrlSet } from "@/lib/media";
import type { Rarity } from "@/lib/card-rarity";
import { secretTierCaption, secretTierStyle } from "@/lib/secret-rarity";
import { rosterFavouriteId, secretFavouriteId, useVaultFavourites } from "@/lib/vault-favourites";
import { stepIndex } from "@/lib/zoom";

/**
 * One card, resolved. The caller owns every query; this component owns none.
 *
 * A discriminated union rather than one shape with optional halves: a secret has
 * no edition and a roster card has no level, and the two vocabularies are kept
 * apart on purpose — see the headers of card-edition.ts and secret-rarity.ts.
 */
export type ViewerCard =
  | {
      kind: "roster";
      /** `event_participants.id`. */
      id: string;
      name: string;
      rarity: Rarity;
      /** The finish on YOUR copy, not the player's. */
      edition: Edition;
      frontUrl: ImageUrlSet | null;
      /** The event's universal back while locked, this card's own once packed. */
      backUrl: ImageUrlSet | null;
      /** Drawn on the back when there is no uploaded back art. */
      back: ReactNode;
      locked: boolean;
      /** Copies you hold. 0 while locked. */
      copies: number;
    }
  | {
      kind: "secret";
      /** `secret_cards.id`. Never reaches a URL — see the header below. */
      id: string;
      name: string;
      rarity: Rarity;
      tier: string;
      flavour: string | null;
      firstPulledOn: string;
      /** How many PEOPLE have found this. Never how many cards exist. */
      ownerCount: number;
      frontUrl: string | null;
      backUrl: ImageUrlSet | null;
      back: ReactNode;
      copies: number;
    };

/**
 * The card, as big as the phone allows, before anything else.
 *
 * §6: the card detail screen was the top 45% of a stats page, and the secret was
 * a 92vw dialog with the card capped at 320px. This is the one surface both of
 * them open into now — same gestures, same controls, same size rule, whichever
 * half of the collection you tapped.
 *
 * IT HOLDS NO DATA AND TOUCHES NO ROUTER. The caller passes a resolved list and
 * says what stepping and closing mean, which is what lets the vault open a secret
 * with no URL at all while the player page keeps `?view=1` for a roster card. A
 * secret card's id must never be addressable — a URL is shareable, and that is
 * the one thing a secret card must not be. See the header of the sheet this
 * replaced, and `players.index.tsx` for the two call sites.
 */
export function CardViewer({
  cards,
  index,
  onStep,
  onClose,
  onDetails,
  onShare,
  sharing = false,
  onCompare,
  onOffer,
  onAsk,
}: {
  cards: ViewerCard[];
  index: number;
  /** Where a swipe lands. Wrapping is done here; the caller just goes there. */
  onStep: (next: number) => void;
  /** Close (the ✕), Escape, and a pull down all mean this. */
  onClose: () => void;
  /** Drop to the stats page. Omitted for a secret, which has no second step. */
  onDetails?: () => void;
  onShare?: () => void;
  sharing?: boolean;
  onCompare?: () => void;
  /** Hand this card over. Offered only when there is a spare of it. */
  onOffer?: () => void;
  /** Go asking for it. Offered only on a card you have not packed. */
  onAsk?: () => void;
}) {
  const card = cards[index] ?? null;
  const [flipped, setFlipped] = useState(false);
  // The surface node, for the menu below. State rather than reading the ref
  // during render: the ref is null on the first pass, and a portal target that
  // arrives late leaves the menu portalled to the body for its whole life.
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  // Tracked rather than left to the DOM, because the keyboard below has to defer
  // to it: Escape over an open menu means "shut the menu", and the arrow keys
  // mean "move down it" — neither of them means "leave the card".
  const [menuOpen, setMenuOpen] = useState(false);
  const favourites = useVaultFavourites();
  // role="dialog" and aria-modal describe an overlay; they do not confine one.
  // The shared hook takes focus, cycles Tab inside and hands it back on close.
  const surfaceRef = useModalSurface<HTMLDivElement>(!!card);

  /**
   * One node, wanted two ways: as a ref by the focus trap, and as a value by the
   * menu below, which needs somewhere to portal to while it renders.
   *
   * Memoised, and that is the whole point of it being here rather than inline. A
   * fresh callback identity every render makes React detach and reattach the ref
   * on every one of them — so an inline version runs `setSurface(null)` and then
   * `setSurface(node)` per render, and leans on batching collapsing the pair back
   * to a no-op to avoid a loop. Stable, it attaches once and detaches on unmount.
   */
  const holdSurface = useCallback(
    (node: HTMLDivElement | null) => {
      surfaceRef.current = node;
      setSurface(node);
    },
    [surfaceRef],
  );

  // A new card always lands face up, however the last one was left.
  useEffect(() => setFlipped(false), [card?.id]);

  // Escape, and the arrow keys for the swipe. Nothing else in this codebase
  // hand-rolls an Escape handler — every other dialog is Radix or vaul and gets
  // one for free — so it is spelled out here rather than assumed. Capture, so a
  // control inside the viewer cannot swallow it first.
  useEffect(() => {
    if (menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (cards.length < 2) return;
      if (e.key === "ArrowLeft") onStep(stepIndex(index, cards.length, -1));
      if (e.key === "ArrowRight") onStep(stepIndex(index, cards.length, 1));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [cards.length, index, menuOpen, onClose, onStep]);

  // The page underneath is still scrollable, and on the details page it is a very
  // long one: a drag over the card's margins would scroll the stats around behind
  // the viewer. Restored rather than cleared, so whatever the body had before —
  // including another surface's lock — is what it goes back to.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!card) return null;

  const locked = card.kind === "roster" && card.locked;
  // The withholding is structural, exactly as in locked-card.tsx: a card you have
  // not packed wears the locked tier here, never its own. §6 flags the details
  // page's ribbon for printing "DNF" over art nobody has seen, which is the one
  // spoiler the vault's LOCKED_RARITY_RANK goes to lengths to avoid.
  const tint = locked ? LOCKED_RARITY : card.rarity;
  const edition: Edition = card.kind === "roster" && !locked ? card.edition : "standard";
  const favouriteId =
    card.kind === "roster" ? rosterFavouriteId(card.id) : secretFavouriteId(card.id);
  const pinned = favourites.isFavourite(favouriteId);

  const go = (dir: -1 | 1) => {
    if (cards.length < 2) return;
    onStep(stepIndex(index, cards.length, dir));
  };

  const menu: {
    key: string;
    label: string;
    icon: ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }[] = [];
  // The three that act on the card itself are meaningless while it is face-down:
  // there is no face to export, and nothing to line up against another card.
  if (onShare && !locked) {
    menu.push({
      key: "share",
      label: sharing ? "Rendering…" : "Share",
      icon: <Share2 className="h-4 w-4" />,
      // The export refetches the signed URLs and then reads the DOM after a
      // settle delay; a second one started over the top of the first races it
      // for the same node. The details page's own chip is disabled the same way.
      disabled: sharing,
      onSelect: onShare,
    });
  }
  // Never on a locked slot — there is nothing to pin about a card you have not
  // seen, and no copy to draw on the shelf if you did.
  if (!locked) {
    menu.push({
      key: "pin",
      label: pinned ? "Pinned" : "Pin",
      icon: <Star className="h-4 w-4" fill={pinned ? "currentColor" : "none"} aria-hidden />,
      onSelect: () => favourites.toggle(favouriteId),
    });
  }
  if (onCompare && !locked) {
    menu.push({
      key: "compare",
      label: "Compare",
      icon: <GitCompareArrows className="h-4 w-4" />,
      onSelect: onCompare,
    });
  }
  // Spares, not copies: handing over the only one you hold is a decision the
  // trade screen makes you look at, not something to start from a menu.
  if (onOffer && card.copies > 1) {
    menu.push({
      key: "offer",
      label: "Offer this card",
      icon: <Handshake className="h-4 w-4" />,
      onSelect: onOffer,
    });
  }
  if (onAsk && locked) {
    menu.push({
      key: "ask",
      label: "Ask for this card",
      icon: <Handshake className="h-4 w-4" />,
      onSelect: onAsk,
    });
  }

  return (
    <div
      ref={holdSurface}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={locked ? `${card.name} — not packed yet` : card.name}
      data-testid="card-viewer"
      // The two axes every tier-coloured child reads. CardRibbon and the pips sit
      // outside the details page's subtree here, so the viewer sets them itself.
      style={
        {
          "--tier": tint.accent,
          "--edn": editionStyle(edition).accent,
        } as React.CSSProperties
      }
      className="fixed inset-0 z-50 outline-none"
    >
      {/* The shell gets out of the way: nav faded and inert, toasts and the
          offline banner stood down. Released on unmount, by the component. */}
      <PresentationMode active />
      {/* The dark room. A SIBLING of the card, never an ancestor — backdrop-filter
          is a grouping property and would flatten the hero tilt into a cutout. */}
      <PresentationStage active />

      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/*
          Sized off the viewport's HEIGHT, the way the reveal stand is
          (pack-stand.tsx). HoloCard derives its height from its width via
          aspect-ratio, so a width-only cap puts a 358px card 500px tall on a
          short phone and pushes the name and the controls off the bottom of a
          layer that has nowhere to scroll to.

          16rem is this viewer's chrome, not the stand's 19: the zoom row under
          the card (3.25), the name and its badge (3.25), the control row (3.5),
          the Details tab (3.25), the gaps between them (2.25) and the padding
          above and below (1.5). Measured rather than estimated — 15 left a
          375x667 phone with five pixels above the card and the Details tab
          pressed against the bottom edge.

          28rem rather than the stand's 320px cap, because "as big as the phone
          allows" is the whole brief — on a phone the column's own width binds
          first anyway, and the cap only ever decides anything on a desktop.
        */}
        <div className="w-full max-w-[min(28rem,calc((100svh-16rem)*5/7))]">
          <ZoomPanFrame
            onSwipe={go}
            // Down to leave, up for more. The one gesture reader owns both, so
            // there is no second layer contending for the same pointer.
            onVerticalSwipe={(dir) => (dir === 1 ? onClose() : onDetails?.())}
            onTap={() => {
              if (locked) return;
              // The zoom frame swallows the click, so HoloCard's own toggle — and
              // the sound that rides on it — never fires on a full-size surface.
              playFlip();
              setFlipped((f) => !f);
            }}
            // Chevrons are implicit via the swipe (§6); the row keeps the zoom
            // controls and the position, which is the whole of what it is for.
            canNavigate={false}
            position={cards.length > 1 ? `${index + 1} / ${cards.length}` : undefined}
          >
            {({ zoomed }) => (
              <div data-testid="card-viewer-card">
                {locked ? (
                  <LockedCard back={card.backUrl} name={card.name} />
                ) : (
                  <HoloCard
                    frontUrl={card.frontUrl}
                    backUrl={card.backUrl}
                    name={card.name}
                    rarity={card.rarity}
                    edition={card.kind === "roster" ? card.edition : undefined}
                    tilt="hero"
                    flipped={flipped}
                    onFlippedChange={setFlipped}
                    // While magnified the frame owns the pointer; a card leaning
                    // under a pan would make the thing you are reading move.
                    interactive={!zoomed}
                    // The horizontal throw means "next card" here.
                    flickToFlip={false}
                    backContent={card.back}
                  />
                )}
              </div>
            )}
          </ZoomPanFrame>
        </div>

        <div className="flex w-full max-w-[28rem] flex-col items-center gap-1.5 text-center">
          <h2 className="font-display w-full truncate text-viewer-name font-black uppercase leading-none">
            {card.name}
          </h2>
          {locked ? (
            <Link to="/players/pack" className="neon-btn-sm">
              <PackageOpen className="h-4 w-4" />
              Rip a pack to see this card
            </Link>
          ) : card.kind === "roster" ? (
            <CardRibbon rarity={card.rarity} edition={card.edition} />
          ) : (
            <SecretLine card={card} />
          )}
        </div>

        <div className="grid w-full max-w-[28rem] grid-cols-3 items-center">
          <ViewerButton label="Close" onClick={onClose} className="justify-self-start">
            <X className="h-5 w-5" />
          </ViewerButton>
          <button
            type="button"
            onClick={() => {
              playFlip();
              setFlipped((f) => !f);
            }}
            disabled={locked}
            aria-pressed={flipped}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 justify-self-center rounded-md border border-white/10 bg-background/70 px-4 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
          >
            <RotateCw className="h-4 w-4" aria-hidden />
            {flipped ? "Front" : "Flip"}
          </button>
          {/* Not modal: the viewer already owns the screen, and a second layer
              juggling the body's pointer-events over the top of it is how a menu
              ends up leaving the page inert after it has closed. */}
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                disabled={menu.length === 0}
                className="inline-flex h-11 w-11 items-center justify-center justify-self-end rounded-md border border-white/10 bg-background/70 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            {/* Portalled INTO the viewer, not onto the body. useModalSurface
                cycles Tab within this surface and pulls focus back the moment it
                lands outside it — which, with the menu on the body, meant Tab
                over an open menu jumped to the Close button instead of reaching
                Radix's own handler. */}
            <DropdownMenuContent
              container={surface}
              align="end"
              side="top"
              className="min-w-[11rem]"
            >
              {menu.map((a) => (
                <DropdownMenuItem
                  key={a.key}
                  onSelect={a.onSelect}
                  disabled={a.disabled}
                  className="min-h-11 gap-2 text-label font-bold uppercase tracking-[0.08em]"
                >
                  {a.icon}
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* The second step, and only ever a step down: the card is the thing and
            the stats are what you go looking for. A flick up does the same. */}
        {onDetails && (
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-primary"
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
            Details
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Everything a secret says about itself, which is deliberately less than a roster
 * card says: the level of YOUR copy, when you found it, how many you hold, and
 * how many PEOPLE have found it. Never a denominator, never a set size.
 */
function SecretLine({ card }: { card: Extract<ViewerCard, { kind: "secret" }> }) {
  return (
    <>
      {card.flavour && (
        <p className="text-sm italic text-muted-foreground">&ldquo;{card.flavour}&rdquo;</p>
      )}
      {/* The level of this copy, in its own colour, above the word — at this size
          the pips are the thing that is actually read. The foil is the card's
          look and says nothing about how lucky the pull was. */}
      <LevelPips tier={card.tier} />
      <span
        className="font-display text-sm font-black uppercase tracking-[0.3em]"
        style={{ color: secretTierStyle(card.tier).accent }}
      >
        {secretTierCaption(card.tier)}
      </span>
      <span className="text-meta font-semibold text-muted-foreground">
        Pulled {formatDay(card.firstPulledOn)}
        {card.copies > 1 && (
          <span style={{ color: card.rarity.accent }}> · Pulled ×{card.copies}</span>
        )}
      </span>
      {packedByLabel(card.ownerCount) && (
        <span className="text-meta font-semibold text-muted-foreground">
          {card.ownerCount === 1
            ? "You are the only one who has found this"
            : packedByLabel(card.ownerCount)}
        </span>
      )}
    </>
  );
}

function ViewerButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-background/70 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
