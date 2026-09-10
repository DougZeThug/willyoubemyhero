import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { TradeItemTile, type RosterCardLookup } from "@/components/trade-offer-card";
import { useModalSurface } from "@/hooks/use-modal-surface";
import { useTradeSpares } from "@/hooks/use-trades";
import { rarityRank } from "@/lib/card-rarity";
import type { ImageUrlSet } from "@/lib/media";
import type { TradeIntent } from "@/lib/trade-intent";
import {
  BUILDER_STEPS,
  MAX_PER_SIDE,
  blockedItems,
  blockedKey,
  hasLastCopy,
  pickerItems,
  spareForIntent,
  stepBlocker,
  toggleStaged,
  type BuilderStep,
  type Staged,
} from "@/lib/trade-staging";
import { BLOCKED_LABEL, tradeItemsLabel, type TradeSpares } from "@/lib/trades";
import { cn } from "@/lib/utils";

export type BuilderCounterparty = { id: string; name: string };

export type TradeBuilderProps = {
  /** The viewer — the first half of every tradeSparesKey read in here. */
  me: string;
  counterparties: BuilderCounterparty[];
  nameOf: (participantId: string) => string;
  lookup: RosterCardLookup;
  /** The event's universal back, shown instead of art you have not pulled. */
  backUrl: ImageUrlSet | null;
  /** No active event: an empty tray is the season, not a bug. */
  outOfSeason: boolean;
  offline: boolean;
  /** True while createTradeOffer is in flight. */
  sending: boolean;
  /** Taken once by the route on arrival; consumed in here. */
  intent: TradeIntent | null;
  /** Resolves to the new offer id, or null on failure — the builder stays open on null. */
  onSend: (offer: {
    recipientId: string;
    give: Staged[];
    want: Staged[];
  }) => Promise<string | null>;
  onClose: () => void;
};

/** vaul's own slide-out, which the sheet is held on screen for. */
const SHEET_EXIT_MS = 500;

const STEP_TITLE: Record<BuilderStep, string> = {
  who: "Who are you trading with?",
  trays: "What is on the table?",
  review: "Does this look right?",
};

/**
 * Building an offer, as three screens rather than as a form (§10).
 *
 * The compose panel it replaces was a wrapping row of 33px pills above two
 * horizontal strips of 84px tiles that looked identical to each other, with no
 * tray, no summary and nothing that said what the deal was. A person scanning it
 * saw four rows of the same cards.
 *
 * IT HOLDS THE OFFER AND NOTHING ELSE. No router, no server function: `onSend`
 * and `onClose` are props, and the only data it fetches is the two spares lists
 * it needs to draw. That is what lets its test render it with no providers at
 * all, and it is why the half-built offer dies with the component — which is
 * exactly what "kept in memory until sent or cancelled" means.
 */
export function TradeBuilder({
  me,
  counterparties,
  nameOf,
  lookup,
  backUrl,
  outOfSeason,
  offline,
  sending,
  intent,
  onSend,
  onClose,
}: TradeBuilderProps) {
  const [step, setStep] = useState<BuilderStep>("who");
  const [theirId, setTheirId] = useState<string | null>(null);
  const [give, setGive] = useState<Staged[]>([]);
  const [want, setWant] = useState<Staged[]>([]);
  /** Which tray's picker is open. Also what Escape defers to. */
  const [picking, setPicking] = useState<"give" | "want" | null>(null);
  /**
   * Which picker is on screen, which trails `picking` out by one animation.
   *
   * vaul slides the sheet away itself and then unmounts on `transitionend` —
   * right in a browser, and never in a test runner, where a closed sheet sits
   * there forever still holding the page's `pointer-events: none`. Taking it out
   * on a timer instead happens behind vaul's own animation, so nothing is lost
   * on a phone, and a closed sheet is genuinely gone whoever is looking.
   */
  const [sheetFor, setSheetFor] = useState<"give" | "want" | null>(null);
  const [intentLeft, setIntentLeft] = useState<TradeIntent | null>(intent);

  const mySpares = useTradeSpares(me, me);
  const theirSpares = useTradeSpares(theirId, me);

  // False while the picker is up: useModalSurface pulls focus back to this
  // surface on Tab, and vaul portals its content to document.body — outside it.
  // Handing the trap over is one line; fighting it is a bug nobody can see.
  const surfaceRef = useModalSurface<HTMLDivElement>(!picking);

  useEffect(() => {
    if (picking) {
      setSheetFor(picking);
      return;
    }
    const t = setTimeout(() => setSheetFor(null), SHEET_EXIT_MS);
    return () => clearTimeout(t);
  }, [picking]);

  const back = useCallback(() => {
    const i = BUILDER_STEPS.indexOf(step);
    if (i <= 0) onClose();
    else setStep(BUILDER_STEPS[i - 1]);
  }, [step, onClose]);

  // Escape, hand-rolled for the same reason card-viewer.tsx hand-rolls its own:
  // this is not a Radix surface. Capture phase so it beats anything underneath,
  // and it defers to the picker — Escape over an open drawer means "shut the
  // drawer", not "throw away the offer".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || picking) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [picking, onClose]);

  // The page behind is still a scrolling column, and a phone will happily scroll
  // it under a fixed overlay. Saved and restored rather than set to "" on the way
  // out, so nesting vaul's own lock inside this one cannot strand the page.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const rosterRank = useCallback(
    (eventParticipantId: string) => rarityRank(lookup(eventParticipantId).rarity.tier),
    [lookup],
  );

  /**
   * Stage the intended card the moment a counterparty is picked.
   *
   * Deliberately survives a partner switch until it lands: "ask Bob, no, ask
   * Carol" is the normal way this goes, and only one of them has the card.
   */
  useEffect(() => {
    if (!intentLeft || !theirId) return;
    const staged = spareForIntent(
      intentLeft,
      intentLeft.side === "give" ? mySpares.data : theirSpares.data,
    );
    if (!staged) return;
    const set = intentLeft.side === "give" ? setGive : setWant;
    setIntentLeft(null);
    set((list) => (list.some((x) => x.key === staged.key) ? list : [...list, staged]));
  }, [intentLeft, theirId, mySpares.data, theirSpares.data]);

  /**
   * What the Trading Post says back to somebody who arrived from a card.
   *
   * Three states, and the third is the one worth having: the intent is still
   * live, a counterparty is picked, and their spares have landed without it —
   * which means they simply have not got a spare of it. Saying so beats leaving
   * a tray mysteriously empty under a banner promising a card.
   */
  const intentLine = useMemo(() => {
    if (!intentLeft) return null;
    const what =
      intentLeft.kind === "secret" ? intentLeft.name : lookup(intentLeft.eventParticipantId).name;
    const side = intentLeft.side === "give" ? mySpares : theirSpares;
    if (theirId && !side.isPending && !spareForIntent(intentLeft, side.data)) {
      return intentLeft.side === "give"
        ? `You have no spare ${what} to offer.`
        : `${nameOf(theirId)} has no spare ${what}.`;
    }
    return intentLeft.side === "give"
      ? `Offering your spare ${what} — pick who to send it to.`
      : `Asking for ${what} — pick who to ask.`;
  }, [intentLeft, lookup, mySpares, theirSpares, theirId, nameOf]);

  function toggle(side: "give" | "want", staged: Staged) {
    const [list, set] = side === "give" ? [give, setGive] : [want, setWant];
    const { next, capped } = toggleStaged(list, staged);
    if (capped) {
      toast(`${MAX_PER_SIDE} cards a side is the limit`);
      return;
    }
    set(next);
  }

  const blocker = stepBlocker(step, { theirId, give, want });
  const theirName = theirId ? nameOf(theirId) : "";

  async function send() {
    if (!theirId || give.length === 0 || want.length === 0) return;
    await onSend({ recipientId: theirId, give, want });
    // Nothing here on success: a sent offer unmounts this component, and a
    // failed one must leave every staged card exactly where it was.
  }

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Make an offer"
      // The app's own ground, opaque, rather than the dimmed vignette a ceremony
      // gets. A card being revealed wants the room behind it; a form does not —
      // 80% over a busy Trading Post left the heading and an offer card legible
      // straight through the flow.
      className="card-bg fixed inset-0 z-50 flex flex-col pt-safe px-safe outline-none"
    >
      <header className="flex items-center justify-between gap-2 border-b border-primary/20 px-2 py-2">
        <button
          type="button"
          onClick={back}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {step === "who" ? "Cancel" : "Back"}
        </button>
        {/* Where in the flow this is, without a progress bar nobody would read.
            The step's question is a heading in the column below instead: at 390
            a centred title between two controls truncates to "Who are you tra…". */}
        <span className="shrink-0 pr-2 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {BUILDER_STEPS.indexOf(step) + 1} of {BUILDER_STEPS.length}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-4 font-display text-2xl font-black uppercase leading-none tracking-wide text-foreground">
            {STEP_TITLE[step]}
          </h2>
          {intentLine && (
            // Announced, not just drawn: somebody arrives here mid-thought from
            // a card they were looking at, and the screen has to pick that
            // thought back up.
            <p role="status" className="mb-3 text-sm text-primary">
              {intentLine}
            </p>
          )}

          {/* Each step is UNMOUNTED rather than hidden. A hidden Who list leaves
              player-named buttons in the tree that collide with the picker's
              player-named tiles under getByRole("button"). */}
          {step === "who" && (
            <WhoList
              me={me}
              counterparties={counterparties}
              theirId={theirId}
              onPick={(id) => {
                setTheirId(id === theirId ? null : id);
                // Their spares are half of what is staged, so keeping the
                // selection across a switch would send cards the new
                // counterparty does not own.
                setGive([]);
                setWant([]);
              }}
            />
          )}

          {step === "trays" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Tray
                label="You give"
                staged={give}
                spares={mySpares.data}
                loading={mySpares.isPending}
                failed={mySpares.isError}
                onRetry={() => void mySpares.refetch()}
                lookup={lookup}
                backUrl={backUrl}
                outOfSeason={outOfSeason}
                addLabel="Add your cards"
                onAdd={() => setPicking("give")}
                onRemove={(s) => toggle("give", s)}
              />
              <Tray
                label="You get"
                staged={want}
                spares={theirSpares.data}
                loading={theirSpares.isPending}
                failed={theirSpares.isError}
                onRetry={() => void theirSpares.refetch()}
                lookup={lookup}
                backUrl={backUrl}
                outOfSeason={outOfSeason}
                conceal
                addLabel={`Ask for ${theirName}'s cards`}
                onAdd={() => setPicking("want")}
                onRemove={(s) => toggle("want", s)}
              />
            </div>
          )}

          {step === "review" && (
            <Review
              give={give}
              want={want}
              lookup={lookup}
              backUrl={backUrl}
              theirName={theirName}
            />
          )}
        </div>
      </div>

      <footer className="border-t border-primary/20 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <div className="mx-auto max-w-3xl">
          {step === "review" ? (
            <button
              type="button"
              onClick={send}
              disabled={sending || offline || !!stepBlocker("trays", { theirId, give, want })}
              className="neon-btn-lg neon-btn-hero w-full disabled:opacity-40"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Send offer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(BUILDER_STEPS[BUILDER_STEPS.indexOf(step) + 1])}
              disabled={!!blocker}
              className="neon-btn-lg w-full disabled:opacity-40"
            >
              {step === "who" ? "Next" : "Review"}
            </button>
          )}
          {/* The reason, in words, under the control it disables. A disabled
              button that says nothing is the thing the offline banner work
              already rejected. */}
          {blocker && step !== "review" && (
            <p role="status" className="mt-2 text-center text-meta text-muted-foreground">
              {blocker}
            </p>
          )}
          {offline && step === "review" && (
            <p role="status" className="mt-2 text-center text-meta text-muted-foreground">
              You are offline — this needs a connection.
            </p>
          )}
        </div>
      </footer>

      {sheetFor !== null && (
        <SparePickerDrawer
          open={picking !== null}
          onOpenChange={(open) => !open && setPicking(null)}
          // Read off `sheetFor` rather than `picking`, so the sheet does not
          // blank out halfway through its own slide down.
          title={sheetFor === "want" ? `${theirName}'s cards` : "Your cards"}
          spares={sheetFor === "want" ? theirSpares.data : mySpares.data}
          loading={sheetFor === "want" ? theirSpares.isPending : mySpares.isPending}
          failed={sheetFor === "want" ? theirSpares.isError : mySpares.isError}
          onRetry={() => void (sheetFor === "want" ? theirSpares : mySpares).refetch()}
          staged={sheetFor === "want" ? want : give}
          lookup={lookup}
          rosterRank={rosterRank}
          backUrl={backUrl}
          conceal={sheetFor === "want"}
          outOfSeason={outOfSeason}
          onToggle={(s) => toggle(sheetFor, s)}
        />
      )}
    </div>
  );
}

/**
 * Who to trade with — a list, not pills (§10 problem 2).
 *
 * Twelve possible partners used to be two rows of identical 33px chips with no
 * avatar, no `aria-pressed` and no hint of what anybody had. These are 56px rows
 * that say who somebody is and how much they have to trade.
 */
function WhoList({
  me,
  counterparties,
  theirId,
  onPick,
}: {
  me: string;
  counterparties: BuilderCounterparty[];
  theirId: string | null;
  onPick: (id: string) => void;
}) {
  if (counterparties.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody else has claimed their player or signed in yet.
      </p>
    );
  }
  return (
    <ul role="group" aria-label="Who to trade with" className="space-y-1.5">
      {counterparties.map((p) => (
        <li key={p.id}>
          <WhoRow person={p} me={me} selected={p.id === theirId} onPick={() => onPick(p.id)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One person, and what they have.
 *
 * The count is its own `getTradeSpares` — there is no bulk endpoint and this PR
 * adds no server function. That is one request per partner, at most twelve in a
 * thirteen-person league, each cached for thirty seconds; and it doubles as the
 * prefetch for the picker two taps later, which used to sit spinning on
 * "Counting spares…" the moment somebody was chosen.
 */
function WhoRow({
  person,
  me,
  selected,
  onPick,
}: {
  person: BuilderCounterparty;
  me: string;
  selected: boolean;
  onPick: () => void;
}) {
  const spares = useTradeSpares(person.id, me);
  const count = spares.data
    ? (spares.data.roster?.length ?? 0) + (spares.data.secrets?.length ?? 0)
    : null;
  // Three states, not two: an unanswered read and a failed one both have no
  // count, and an ellipsis that never resolves is the worse of the two to show.
  const spareLine = spares.isError
    ? "spares unknown"
    : count === null
      ? null
      : `${count} ${count === 1 ? "spare" : "spares"}`;

  return (
    <button
      type="button"
      aria-pressed={selected}
      // Spelled out rather than left to the name and the count running together:
      // two stacked block elements concatenate with no space between them, so
      // the row announced as "Bob Blitz5 spares".
      aria-label={spareLine ? `${person.name}, ${spareLine}` : person.name}
      onClick={onPick}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors",
        // Selection is a 2px ring, not a bloom (§15).
        selected
          ? "border-primary/60 bg-primary/10 ring-2 ring-primary/50"
          : "border-border-strong bg-white/5 hover:border-primary",
      )}
    >
      {/* The initials repeat the name beside them, so they are decoration —
          and left in the accessibility tree they turn every row's name into
          "BB Bob Blitz 5 spares". */}
      <span aria-hidden>
        <ParticipantAvatar name={person.name} size={40} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-black uppercase tracking-wide">
          {person.name}
        </span>
        <span className="block text-meta text-muted-foreground">{spareLine ?? "…"}</span>
      </span>
    </button>
  );
}

/**
 * One side of the table, as a tray rather than a strip.
 *
 * The old picker put everything you owned in a horizontal scroller and called the
 * result an offer. Staging is a decision, so the staged cards get their own
 * space, two across, with a 44px way to change your mind (§10 problem 4).
 */
function Tray({
  label,
  staged,
  spares,
  loading,
  lookup,
  backUrl,
  outOfSeason,
  failed,
  onRetry,
  conceal = false,
  addLabel,
  onAdd,
  onRemove,
}: {
  label: string;
  staged: Staged[];
  spares: TradeSpares | undefined;
  loading: boolean;
  lookup: RosterCardLookup;
  backUrl: ImageUrlSet | null;
  outOfSeason: boolean;
  /** The spares read failed. Distinct from having none, which is a fact. */
  failed: boolean;
  /** Ask for the spares again — the only way out of `failed` without leaving. */
  onRetry: () => void;
  conceal?: boolean;
  addLabel: string;
  onAdd: () => void;
  onRemove: (staged: Staged) => void;
}) {
  // Blocked cards count as something to show. Somebody whose only copies are
  // all only-copies has plenty in the picker — a greyed row with "only copy" on
  // it, which is the answer to "where is my card?" and the whole reason that row
  // exists. Hiding the button behind a spares count would bury it.
  const nothingToOffer =
    !loading &&
    !failed &&
    (spares?.roster?.length ?? 0) +
      (spares?.secrets?.length ?? 0) +
      (spares?.blocked?.length ?? 0) ===
      0;

  return (
    <section aria-label={label} className="surface-panel rounded-xl border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-badge font-bold uppercase tracking-[0.08em] text-primary">
          {label}
        </h3>
        <span className="text-label font-bold tabular text-muted-foreground">
          {staged.length} / {MAX_PER_SIDE}
        </span>
      </div>

      {staged.length > 0 && (
        <ul className="mb-3 grid grid-cols-2 gap-2">
          {staged.map((s) => (
            <li key={s.key} className="flex flex-col items-center">
              <TradeItemTile
                item={s.item}
                lookup={lookup}
                size="lg"
                concealed={conceal && s.item.viewerOwns === false}
                backUrl={backUrl}
              />
              <button
                type="button"
                onClick={() => onRemove(s)}
                aria-label={`Remove ${s.item.kind === "secret" ? s.item.name : lookup(s.item.eventParticipantId).name}`}
                className="mt-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The reason lives on the TRAY, not inside the drawer. An empty tray whose
          explanation is behind a button nobody has pressed reads as a broken
          screen — which is what B-33 is about. */}
      {loading ? (
        <p className="text-meta text-muted-foreground">Counting spares…</p>
      ) : failed ? (
        // `getTradeSpares` is a member-guarded read that deliberately does not
        // retry, so a token that expired mid-party lands here. Saying "no spares
        // to trade" instead would be a claim about somebody's collection that
        // the app has no basis for, and it takes the add button away with it.
        //
        // The button matters as much as the wording. Automatic retries are off
        // on purpose, and focus refetching only helps somebody who leaves the
        // app and comes back — which is not a thing to ask of a person standing
        // in a garden mid-offer. A tap is what gets them out of here.
        <div role="status">
          <p className="text-meta text-warn">Couldn&apos;t count the spares.</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border-strong px-4 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Try again
          </button>
        </div>
      ) : nothingToOffer ? (
        <p className="text-meta text-muted-foreground">
          {outOfSeason ? "Trading opens with the next combine." : "No spares to trade."}
        </p>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-primary/40 px-4 text-label font-bold uppercase tracking-[0.08em] text-primary transition-colors hover:bg-primary/10"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {addLabel}
        </button>
      )}
    </section>
  );
}

/** The picker, as a bottom sheet: the half of the screen a thumb reaches (§26). */
function SparePickerDrawer({
  open,
  onOpenChange,
  title,
  spares,
  loading,
  failed,
  onRetry,
  staged,
  lookup,
  rosterRank,
  backUrl,
  conceal,
  outOfSeason,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  spares: TradeSpares | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  staged: Staged[];
  lookup: RosterCardLookup;
  rosterRank: (eventParticipantId: string) => number;
  backUrl: ImageUrlSet | null;
  conceal: boolean;
  outOfSeason: boolean;
  onToggle: (staged: Staged) => void;
}) {
  const items = pickerItems(spares, rosterRank);
  const blocked = blockedItems(spares);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle className="font-display text-sm font-bold uppercase tracking-wide">
            {title}
          </DrawerTitle>
          {/* The cap where the choosing happens, not only on the tray behind. */}
          <DrawerDescription className="text-xs">
            {staged.length} / {MAX_PER_SIDE} chosen
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-8">
          {loading ? (
            <p className="text-meta text-muted-foreground">Counting spares…</p>
          ) : failed ? (
            <div role="status">
              <p className="text-meta text-warn">Couldn&apos;t count the spares.</p>
              <button type="button" onClick={onRetry} className="neon-btn-sm mt-2 w-full">
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-meta text-muted-foreground">
              {outOfSeason ? "Trading opens with the next combine." : "No spares to trade."}
            </p>
          ) : (
            // Tracks sized off the tile rather than a column count: a `lg` tile
            // is a fixed 110px, and three of them plus the drawer's padding need
            // 386px — so at 320 and 375 the old grid-cols-3 overflowed its cells
            // and the tiles sat on each other, which `overflow-x: hidden` hid.
            // auto-fill drops to two across on a narrow phone and back to three
            // as soon as there is room.
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] justify-items-center gap-3">
              {items.map((s) => (
                <li key={s.key}>
                  <TradeItemTile
                    item={s.item}
                    lookup={lookup}
                    size="lg"
                    selected={staged.some((x) => x.key === s.key)}
                    onClick={() => onToggle(s)}
                    concealed={conceal && s.item.viewerOwns === false}
                    backUrl={backUrl}
                  />
                </li>
              ))}
            </ul>
          )}

          {/* Only ever your own side: the server sends `blocked` empty for
              anybody else. Shown so "where is my card?" has an answer on the
              screen rather than reading as data loss. */}
          {blocked.length > 0 && (
            <>
              <h4 className="mt-4 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Can&apos;t be traded
              </h4>
              <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] justify-items-center gap-3">
                {blocked.map((b) => (
                  <li key={blockedKey(b)}>
                    <TradeItemTile
                      item={b.item}
                      lookup={lookup}
                      size="lg"
                      blockedLabel={BLOCKED_LABEL[b.reason]}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Outside the scroller, so a long list cannot bury the way out of it.
            The grab handle and a drag down close this too, but neither is
            something a first-time reader knows is there. */}
        <div className="border-t border-white/10 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          <button type="button" onClick={() => onOpenChange(false)} className="neon-btn-sm w-full">
            Done
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** The deal in one place, which is the thing the old compose panel never had. */
function Review({
  give,
  want,
  lookup,
  backUrl,
  theirName,
}: {
  give: Staged[];
  want: Staged[];
  lookup: RosterCardLookup;
  backUrl: ImageUrlSet | null;
  theirName: string;
}) {
  return (
    <div>
      {/* 16px, and above the cards rather than below them: on a phone, in a
          garden, this is usually the only part anyone reads. */}
      <p className="mb-4 text-base text-foreground">
        <span className="font-semibold text-primary">
          {tradeItemsLabel(give.map((s) => s.item))}
        </span>{" "}
        <span className="text-muted-foreground">for</span>{" "}
        <span className="font-semibold text-primary">
          {tradeItemsLabel(want.map((s) => s.item))}
        </span>
        <span className="text-muted-foreground">, with {theirName}.</span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <ReviewSide label="You give" staged={give} lookup={lookup} backUrl={backUrl} />
        <ReviewSide label="You get" staged={want} lookup={lookup} backUrl={backUrl} conceal />
      </div>

      {(hasLastCopy(give) || hasLastCopy(want)) && (
        <p className="mt-4 text-sm font-semibold text-warn">
          ⚠ One of these is somebody&apos;s last copy. It does not come back.
        </p>
      )}
    </div>
  );
}

function ReviewSide({
  label,
  staged,
  lookup,
  backUrl,
  conceal = false,
}: {
  label: string;
  staged: Staged[];
  lookup: RosterCardLookup;
  backUrl: ImageUrlSet | null;
  conceal?: boolean;
}) {
  return (
    <section aria-label={label} className="surface-panel rounded-xl border p-3">
      <h3 className="mb-2 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </h3>
      <div className="flex flex-wrap gap-2">
        {staged.map((s) => (
          <TradeItemTile
            key={s.key}
            item={s.item}
            lookup={lookup}
            concealed={conceal && s.item.viewerOwns === false}
            backUrl={backUrl}
          />
        ))}
      </div>
    </section>
  );
}
