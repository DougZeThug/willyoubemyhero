import { useEffect, useRef, useState } from "react";
import { Inbox, Send } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { TradeOfferCard, type RosterCardLookup } from "@/components/trade-offer-card";
import { SectionTitle } from "@/components/section-title";
import { tradeSwapPrompt, type TradeOfferView } from "@/lib/trades";
import type { ImageUrlSet } from "@/lib/media";
import { offlineReason } from "@/hooks/use-online";

export type TradeOffersPanelProps = {
  /** The viewer's participant id, which decides which side of each offer reads as "you". */
  me: string;
  inbox: TradeOfferView[];
  outbox: TradeOfferView[];
  recent: TradeOfferView[];
  nameOf: (participantId: string) => string;
  lookup: RosterCardLookup;
  backUrl: ImageUrlSet | null;
  /** The offer mid-request, so only its own buttons go quiet. */
  pending: string | null;
  offline: boolean;
  /** Called only once the confirm sheet has been confirmed. */
  onAccept: (offerId: string) => void;
  onDecline: (offerId: string) => void;
  onCancel: (offerId: string) => void;
  /** The offer just sent, rung for a few seconds so it can be found. */
  highlightId: string | null;
  /** The way forward from an empty inbox. The sticky one is the route's own. */
  onMakeOffer: () => void;
  /** How many people could actually answer an offer, for the empty state's hint. */
  reachableCount: number;
};

/**
 * Everything that is already an offer: waiting on you, out there, and settled.
 *
 * Split out of the route (§10) because the builder used to sit BELOW all of this
 * — starting a trade meant scrolling past everything you had not answered. The
 * two are separate screens now, and this is the one the tab bar opens on.
 */
export function TradeOffersPanel({
  me,
  inbox,
  outbox,
  recent,
  nameOf,
  lookup,
  backUrl,
  pending,
  offline,
  onAccept,
  onDecline,
  onCancel,
  highlightId,
  onMakeOffer,
  reachableCount,
}: TradeOffersPanelProps) {
  /**
   * The offer Accept has been pressed on, waiting for a yes.
   *
   * Accept moves two people's cards and had no confirmation at all (§10 problem
   * 5). Decline and Take it back stay one-tap: neither moves a card, and both
   * already carry an Undo.
   */
  const [confirming, setConfirming] = useState<TradeOfferView | null>(null);

  return (
    <>
      <section className="mb-7">
        <SectionTitle
          icon={<Inbox className="h-4 w-4" />}
          label="Waiting on you"
          count={inbox.length}
        />
        {inbox.length === 0 ? (
          <div className="surface-panel rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Nobody wants your cards. Yet.</p>
            {/* A way forward, which one 12px sentence was not (§10 problem 7).
                Named differently from the sticky button below it on purpose: two
                controls with the same accessible name, 200px apart, is a thing a
                screen reader cannot tell apart. */}
            <button type="button" onClick={onMakeOffer} className="neon-btn-sm mt-3">
              Start the first offer
            </button>
            {reachableCount > 0 && (
              <p className="mt-2 text-meta text-muted-foreground">
                {reachableCount} {reachableCount === 1 ? "player is" : "players are"} on their
                phones.
              </p>
            )}
          </div>
        ) : (
          <OfferCarousel label="Offers waiting on you">
            {inbox.map((offer) => (
              <TradeOfferCard
                key={offer.id}
                offer={offer}
                me={me}
                nameOf={nameOf}
                lookup={lookup}
                backUrl={backUrl}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirming(offer)}
                      disabled={pending === offer.id || offline}
                      {...offlineReason(offline)}
                      className="neon-btn-lg neon-btn-hero w-full disabled:opacity-50 sm:w-auto"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecline(offer.id)}
                      disabled={pending === offer.id || offline}
                      {...offlineReason(offline)}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border-strong px-6 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50 sm:w-auto"
                    >
                      Decline
                    </button>
                  </>
                }
              />
            ))}
          </OfferCarousel>
        )}
      </section>

      {outbox.length > 0 && (
        <section className="mb-7">
          <SectionTitle
            icon={<Send className="h-4 w-4" />}
            label="Out there"
            count={outbox.length}
          />
          <OfferCarousel
            label="Offers you have sent"
            initialIndex={outbox.findIndex((o) => o.id === highlightId)}
          >
            {outbox.map((offer) => (
              <TradeOfferCard
                key={offer.id}
                offer={offer}
                me={me}
                nameOf={nameOf}
                lookup={lookup}
                backUrl={backUrl}
                highlighted={offer.id === highlightId}
                actions={
                  <button
                    type="button"
                    onClick={() => onCancel(offer.id)}
                    disabled={pending === offer.id || offline}
                    {...offlineReason(offline)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-primary/40 px-6 text-label font-bold uppercase tracking-[0.08em] text-primary transition-colors hover:bg-primary/10 disabled:opacity-50 sm:w-auto"
                  >
                    Take it back
                  </button>
                }
              />
            ))}
          </OfferCarousel>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mb-6">
          <SectionTitle label="Recently settled" />
          {/* Folded, newest settlement first. Ten open receipts is five screens of
              history under the two lists that need answering, and the plan this
              screen was built from asked for this strip to stay text-first. The
              summary line on each one names both sides, so a folded receipt is
              still the whole story — which is what a strip of receipts is for. */}
          <div className="space-y-2">
            {recent.map((offer) => (
              <TradeOfferCard
                key={offer.id}
                offer={offer}
                me={me}
                nameOf={nameOf}
                lookup={lookup}
                backUrl={backUrl}
                collapsible
              />
            ))}
          </div>
        </section>
      )}

      <ConfirmAcceptSheet
        offer={confirming}
        me={me}
        nameOf={nameOf}
        lookup={lookup}
        busy={!!confirming && pending === confirming.id}
        offline={offline}
        onConfirm={(offerId) => {
          setConfirming(null);
          onAccept(offerId);
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}

/**
 * The yes/no on the one control that moves somebody else's cards too.
 *
 * The button is called "Confirm" rather than "Accept" quite deliberately: a
 * second control named Accept would make `getByRole("button", { name: "Accept" })`
 * ambiguous, and that locator is how both the e2e suite and a screen reader's
 * rotor reach the offer card behind this sheet.
 */
function ConfirmAcceptSheet({
  offer,
  me,
  nameOf,
  lookup,
  busy,
  offline,
  onConfirm,
  onCancel,
}: {
  offer: TradeOfferView | null;
  me: string;
  nameOf: (participantId: string) => string;
  lookup: RosterCardLookup;
  busy: boolean;
  /**
   * Asked again here rather than trusted from the Accept behind this sheet: the
   * signal can drop in the seconds between opening the question and answering
   * it, and a Confirm that stays lit through that is the one control on the
   * screen that would throw a toast instead of going quiet.
   */
  offline: boolean;
  onConfirm: (offerId: string) => void;
  onCancel: () => void;
}) {
  const iAmProposer = offer ? offer.proposerId === me : false;
  const theirId = offer ? (iAmProposer ? offer.recipientId : offer.proposerId) : null;
  const question = offer
    ? tradeSwapPrompt({
        give: iAmProposer ? offer.proposerGives : offer.recipientGives,
        get: iAmProposer ? offer.recipientGives : offer.proposerGives,
        theirName: nameOf(theirId!),
        rosterName: (id) => lookup(id).name,
      })
    : "";

  return (
    <Drawer open={!!offer} onOpenChange={(open) => !open && onCancel()}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle className="font-display text-base font-bold">{question}</DrawerTitle>
          <DrawerDescription className="text-xs">
            Both collections change the moment you confirm. There is no undo on this one.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-2 px-4 pb-8">
          <button
            type="button"
            disabled={busy || offline}
            {...offlineReason(offline)}
            onClick={() => offer && onConfirm(offer.id)}
            className="neon-btn-lg neon-btn-hero w-full disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border-strong px-6 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * One offer at a time, swiped.
 *
 * A vertical stack of full-size offers buries the second one below the fold on a
 * phone, which is where this screen actually gets used. Scroll-snap rather than a
 * carousel library: the browser already does the physics.
 *
 * The position used to be three decorative `<span>`s, which said nothing at all
 * to anybody not looking at them (§10 problem 8). It is words now, in a live
 * region, so a swipe is announced.
 */
function OfferCarousel({
  children,
  label,
  initialIndex = 0,
}: {
  children: React.ReactNode[];
  /** Names the scroller, which is otherwise an unlabelled group of offers. */
  label: string;
  /** Which one to open on — the freshly-sent offer. Tolerates a -1 from findIndex. */
  initialIndex?: number;
}) {
  const start = initialIndex > 0 && initialIndex < children.length ? initialIndex : 0;
  const [active, setActive] = useState(start);
  const scroller = useRef<HTMLDivElement>(null);

  // Opening on the offer that was just sent, rather than making somebody swipe
  // to find it. `scrollLeft` rather than scrollIntoView: the latter scrolls every
  // ancestor too, which on this page means jumping the whole tab.
  useEffect(() => {
    const el = scroller.current;
    if (!el || start === 0) return;
    el.scrollLeft = start * el.clientWidth;
    setActive(start);
  }, [start]);

  // "1 of 1" is noise, and a single offer needs no scroller around it.
  if (children.length === 1) return <>{children[0]}</>;
  return (
    <div>
      <div
        ref={scroller}
        role="group"
        aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {children.map((child, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            {child}
          </div>
        ))}
      </div>
      <p
        role="status"
        aria-live="polite"
        className="mt-1 text-center text-label font-bold uppercase tracking-[0.08em] text-muted-foreground"
      >
        {Math.min(active + 1, children.length)} of {children.length}
      </p>
    </div>
  );
}
