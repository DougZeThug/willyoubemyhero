import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEnsureGuestSession } from "@/hooks/use-guest-session";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import {
  mySecretsKey,
  secretStatusKey,
  useSecretActor,
  useSecretStatus,
} from "@/hooks/use-daily-secret";
import { HoloCard } from "@/components/holo-card";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { PackOpening } from "@/components/pack-opening";
import { PackStand } from "@/components/pack-stand";
import { rarityMap, rarityStyle, type Rarity } from "@/lib/card-rarity";
import {
  collectCard,
  loadPackState,
  savePackState,
  type CollectedCard,
} from "@/lib/card-collection";
import { myCardStatsKey, useMyCollection } from "@/hooks/use-my-collection";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { playReveal, playSecretRiser, playTear } from "@/lib/card-sfx";
import { celebrate, celebrateSecret } from "@/lib/card-confetti";
import { pullSecretCard } from "@/lib/secret-cards.functions";
import {
  secretFoil,
  SECRET_CHIME,
  SECRET_DUPE_CHIME,
  type SecretCardView,
} from "@/lib/secret-cards";
import { clearMemberToken, useMemberSession } from "@/lib/member-token";
import { usePackIdentity } from "@/lib/device-id";
import { dealPack, packSeed, packStage, resumeCursor, type SecretSlot } from "@/lib/pack";
import { preloadCard } from "@/lib/preload";
import { recordCardPulls } from "@/lib/card-pulls.functions";
import { cardPullCountsKey, useCardPullCounts } from "@/hooks/use-card-pulls";
import { packedByLabel } from "@/lib/card-pulls";
import { urlFromSet } from "@/lib/media.functions";
import type { ImageUrlSet } from "@/lib/media.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/players/pack")({
  head: () => ({
    meta: [
      { title: "Open a Pack — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content:
          "Rip today's pack of combine trading cards. Three cards, dealt to you and nobody else.",
      },
      { property: "og:title", content: "Draft Combine — Open a Pack" },
      { property: "og:description", content: "Three cards. One hit. Nobody else gets this pack." },
    ],
  }),
  component: PackPage,
});

const PACK_SIZE = 3;

/** Hold on the glowing edge before the hit lands. */
const PEEK_MS = 900;
/** The once-a-day card holds longer. It is the only card here nobody has seen. */
const SECRET_PEEK_MS = 1600;
/** Where in that hold the riser starts, so it lands on the chime's bottom note. */
const SECRET_RISER_AT_MS = 700;
/**
 * Short on purpose: staring at a pulsing card while your friends look at theirs
 * is worse than a retry tap. Giving up does not cancel the request — a row may
 * still land — which is exactly why the server re-reads rather than re-rolls.
 */
const SECRET_PULL_TIMEOUT_MS = 6_000;
/** Full ceremony for the first few duplicates; after that it is a tax. */
const DUPE_CEREMONY_LIMIT = 3;
/** How often to notice the date changed under a tab nobody closed. */
const DAY_TICK_MS = 60_000;
/** Beat between cards when the sequence is driving itself. */
const AUTO_STEP_MS = 420;
/**
 * How long a card sits face-down on the stand before the sequence turns it.
 *
 * Load-bearing, not decoration: it is what forces the cursor move and the reveal
 * into separate renders. Batched together, the stand mounts the card with its
 * transform already face-up and there is no flip to see.
 */
const AUTO_MOUNT_MS = 300;

/** Local date key so the pack rolls over at midnight in the user's own timezone. */
function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The fourth slot, as it appears in the finished pack.
 *
 * Appended below the three, never a replaced slot: `nextPack` swaps its *last*
 * entry for a card the user has not collected, and that swap is the only
 * mechanism by which the thirteen-card set ever completes. It also keeps
 * PackState.ids at exactly three roster ids, which is what the e2e suite asserts.
 *
 * The ceremony itself now belongs to PackStand — by the time the columns render,
 * this card has already been turned over. What is left here is the card at rest,
 * plus the two states that never reach the stand at all: a guest who has not
 * claimed, and a pull that could not complete.
 */
function SecretSlotView({
  slot,
  card,
  rarity,
  duplicate,
  pulledCount,
  universalBack,
  onRetry,
}: {
  slot: SecretSlot;
  card: SecretCardView | null;
  rarity: Rarity;
  duplicate: boolean;
  pulledCount: number;
  /** The event's universal deck back. Secrets share it with every other card. */
  universalBack: ImageUrlSet | null;
  onRetry: () => void;
}) {
  if (slot === "hidden") return null;

  return (
    // Wider than a board card, which is now ~173px on a phone. The fourth slot
    // has to stay visibly the biggest thing here or it stops reading as the
    // thing nobody else on the roster has.
    <div className="mx-auto flex w-full max-w-[240px] flex-col items-center gap-2 pt-2">
      <div className="text-center">
        <h2
          className="font-display text-sm font-black uppercase tracking-[0.2em]"
          style={{ color: rarity.accent }}
        >
          One More Card
        </h2>
      </div>

      {slot === "failed" ? (
        <button
          onClick={onRetry}
          className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center opacity-60"
        >
          <span className="font-display text-xs font-black uppercase tracking-[0.2em]">
            No signal
          </span>
          {/* Never a toast: a toast announces a fourth card to whoever is
              glancing at the phone over your shoulder. */}
          <span className="text-[10px] leading-snug text-muted-foreground">
            Tap to try again — you haven&apos;t used today&apos;s.
          </span>
        </button>
      ) : slot === "pending" ? (
        <div className="wax-foil flex aspect-[5/7] w-full animate-pulse items-center justify-center rounded-xl border border-white/15" />
      ) : card ? (
        <>
          {/* w-full is load-bearing: the column above centres its items, which
              makes a flex child shrink to its content, and HoloCard sizes itself
              from its width via aspect-ratio — so without this the card collapses
              to nothing and the slot renders as a sliver. */}
          <motion.div
            layoutId="pack-card-secret"
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className={cn("relative w-full rounded-xl", duplicate && "secret-dupe-shimmer")}
          >
            <HoloCard
              frontUrl={card.artUrl}
              backUrl={universalBack}
              name={card.name}
              rarity={rarity}
              cacheKey={card.id}
              tilt="hero"
              backContent={<SecretBackPanel card={card} rarity={rarity} />}
            />
          </motion.div>
          <div className="text-center">
            <div className="truncate font-display text-xs font-black uppercase tracking-wide">
              {card.name}
            </div>
            {duplicate ? (
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                Already yours — you&apos;ve pulled the whole set. This one&apos;s just showing off.
              </div>
            ) : (
              <div
                className="text-[9px] font-bold uppercase tracking-[0.25em]"
                style={{ color: rarity.border }}
              >
                {/* Taught once, on the first secret anyone ever pulls. Without it
                    the empty vault shelf afterwards reads as a bug. */}
                {pulledCount <= 1
                  ? "Secret · Not on the roster. Nobody knows how many there are."
                  : "Secret · Yours for good, even on a new phone."}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PackPage() {
  const { event, bundle } = useEventBundle();
  const cards = useEventCardUrls(event?.id ?? null);
  // The event's back, never a player's — see the note on useEventCardBack. The
  // wrapper is shown before anything has been dealt, so a per-player back here
  // would be the reveal, printed on the outside of the pack.
  const packBack = useEventCardBack(event?.id ?? null);
  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  // Reconciled against the server rather than read straight off this device — the
  // local store had been inflated to the whole roster by the old collect-on-sight
  // behaviour, which also meant `dealPack` believed there was nothing left to
  // pick as the guaranteed-new last card.
  const rosterIds = useMemo(() => (bundle?.participants ?? []).map((p) => p.id), [bundle]);
  const mine = useMyCollection(event?.id ?? null, rosterIds);
  const collected = mine.collection;
  const collectionLoaded = mine.ready;
  // Snapshot of the collection taken when a pack is dealt. The pack composition
  // must not shift while the user is revealing it, and revealing a card writes
  // straight back into `collected`.
  const [packBaseline, setPackBaseline] = useState<Record<string, CollectedCard> | null>(null);
  // Today's dealt cards, once the wrapper is off. Null means the pack is still
  // sealed; undefined-until-loaded is tracked by `stateLoaded` instead, so the
  // sealed pack never flashes on a day that has already been opened.
  const [dealtIds, setDealtIds] = useState<string[] | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [peeking, setPeeking] = useState(false);
  /**
   * The opening ceremony is playing.
   *
   * Set only by `tearOpen`, never by the resume path: coming back to a pack you
   * already tore should land you on the card you were looking at, not replay the
   * production. Same argument `resumeCursor` makes about the secret — a payoff,
   * not a toll.
   */
  const [opening, setOpening] = useState(false);
  // Readable from the day-tick interval, whose closure cannot see the state.
  const openingRef = useRef(false);
  /**
   * A ceremony ran on this screen, so the stand is mounting out of a deck rather
   * than out of nothing. Survives `opening` going false, which is the whole point
   * — it is read on the render *after* the ceremony ends.
   */
  const ceremonyRanRef = useRef(false);
  // Which card is on the stand. Advanced only by the user: revealing a card does
  // not move it on, because a card you have not looked at yet is not a card you
  // are finished with.
  const [cursor, setCursor] = useState(0);

  // ---- the fourth slot ----
  const me = useMemberSession();
  const qc = useQueryClient();
  const pull = useServerFn(pullSecretCard);
  const record = useServerFn(recordCardPulls);
  const pullCounts = useCardPullCounts(event?.id ?? null);
  // A guest gets an identity minted for them the moment they land here, so the
  // fourth card is theirs rather than a locked slot. Only for the unclaimed —
  // a member already has one.
  useEnsureGuestSession(true);
  const actor = useSecretActor();
  const status = useSecretStatus(actor);
  const [secret, setSecret] = useState<SecretCardView | null>(null);
  const [secretDuplicate, setSecretDuplicate] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretPeeking, setSecretPeeking] = useState(false);
  const [secretPulling, setSecretPulling] = useState(false);
  const [secretFailed, setSecretFailed] = useState(false);
  const [secretUnavailable, setSecretUnavailable] = useState(false);
  // Set synchronously before the request goes out. setDealtIds is async, so two
  // Enter presses in one tick both see the old state; this also survives
  // StrictMode mounting every effect twice in development.
  const pullFiredRef = useRef(false);
  /**
   * A ceremony is running.
   *
   * Also the re-entrancy latch. A card holds for 900ms (1600ms for the secret)
   * before it turns, and for all of that time it is still face-down and still
   * answering taps — so a second tap used to start a whole second ceremony on
   * the same card: two holds, two chimes, two confetti bursts, two writes into
   * the collection, and the index pushed into `revealed` twice.
   */
  const revealingRef = useRef(false);
  /**
   * The revealed indices, readable synchronously.
   *
   * `revealAt` guarded on the `revealed` *state*, which a second call in the
   * same tick — or during a hold — cannot see yet.
   */
  const revealedRef = useRef<number[]>([]);
  /**
   * Indices being turned over for a second time, on a pack migrated off the
   * pre-stand ceremony. They get the flip and the chime and nothing that writes:
   * the pull they represent was recorded the first time round.
   */
  const replayedRef = useRef<Set<number>>(new Set());
  /**
   * This pack was already open when the screen loaded.
   *
   * Which means `recordCardPulls` ran in whatever session tore it, so for a
   * claimed member the reconciled collection already counts every card in it —
   * including the ones still face-down. See the floor in `revealAt`.
   */
  const resumedRef = useRef(false);
  /** Set while "Reveal all" owns the sequence, so nothing else can drive it. */
  const autoRef = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);
  // Mirrors of state the auto sequence has to read *after* awaiting, where its
  // own closure is already stale.
  const secretRef = useRef<SecretCardView | null>(null);
  const pullingRef = useRef(false);
  useEffect(() => {
    secretRef.current = secret;
  }, [secret]);
  useEffect(() => {
    pullingRef.current = secretPulling;
  }, [secretPulling]);

  // The *pack* day is device-local: a pack has no identity and no constraint
  // behind it. The *drop* day is league-owned, decided in Postgres. Two clocks,
  // deliberately — see the server-day effect below.
  const [dayKey, setDayKey] = useState(todayKey);
  // Null until the browser has answered. Nothing is dealt against a half-known
  // identity, or a claimed member would flash a device-seeded pack first.
  const identity = usePackIdentity();
  const seed = identity ? packSeed(event?.id ?? null, dayKey, identity) : null;

  // One pack a day, so a return visit resumes rather than deals. Yesterday's row
  // is simply ignored — the next tear overwrites it.
  useEffect(() => {
    // Wait for the browser to answer who this pack is for. usePackIdentity
    // returns null for one render on every mount while it reads localStorage,
    // and running the load then would compare a stored `d:xxx` against `null`,
    // decide the pack isn't mine, and clear dealtIds — briefly rendering a
    // tearable sealed pack that a fast tap can deal straight over the saved
    // one. Skipping this pass keeps `stateLoaded` false until we know.
    if (identity == null) return;
    let cancelled = false;
    // Cleared first so the rollover below cannot write today's key over
    // yesterday's ids in the window before this resolves.
    setStateLoaded(false);
    loadPackState().then((s) => {
      if (cancelled) return;
      // A stored row without an identity predates per-person packs; treat it
      // as a match so nobody mid-reveal on the day this ships loses their
      // cards. Now that we always wait for `identity` above, a mismatch here
      // means the phone genuinely changed hands.
      const mine = s?.identity == null || s.identity === identity;
      if (s && s.dayKey === dayKey && mine && s.ids.length > 0) {
        // A row the pre-stand ceremony left finished.
        //
        // That screen put every card into `revealed` as the wrapper came off, so
        // resuming one faithfully lands past the end of the stand and renders the
        // finished grid — no wrapper to rip and no cards to step through for the
        // rest of that day, which is indistinguishable from the stand not having
        // shipped. Only those are replayed. A pre-stand row that stopped partway
        // still has cards to turn and is resumed exactly as it stands.
        //
        // Recognised by the missing cursor, because every row the stand has ever
        // written carries one. A version field would have caught the stand's own
        // early rows too and marched somebody back to the first card.
        const replay = s.cursor === undefined && s.revealed.length >= s.ids.length;
        setDealtIds(s.ids);
        const revealedNow = replay ? [] : s.revealed;
        // These cards were pulled once already, under the old ceremony. Turning
        // them over again is theatre; counting them again is not — `collectCard`
        // increments rather than being idempotent, and for a guest the local store
        // *is* the collection, so a replayed pull would inflate "Pulled ×N" for
        // good.
        replayedRef.current = new Set(replay ? s.revealed : []);
        resumedRef.current = true;
        revealedRef.current = revealedNow;
        setRevealed(revealedNow);
        setSecretRevealed(!!s.secretRevealed);
        // Come back to the card you were on, not to the start. The stored cursor
        // is the answer when there is one; `resumeCursor` is the fallback for a
        // row written before the stand existed, and can only ever land on the
        // next unturned card.
        setCursor(
          replay
            ? 0
            : (s.cursor ??
                resumeCursor({
                  packSize: s.ids.length,
                  revealed: s.revealed,
                  secretRevealed: !!s.secretRevealed,
                })),
        );
      } else {
        setDealtIds(null);
        revealedRef.current = [];
        replayedRef.current = new Set();
        resumedRef.current = false;
        setRevealed([]);
        setSecretRevealed(false);
        setCursor(0);
      }
      setStateLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [dayKey, identity]);

  // A tab left open past midnight used to sit on yesterday's pack forever, which
  // with a server-side drop becomes actively confusing: the fourth slot re-arms
  // while the three cards do not. Polled rather than scheduled, because a phone
  // suspends timers the moment the screen goes dark.
  useEffect(() => {
    function check() {
      // Never re-seal a pack under somebody's thumb. Eating a card mid-reveal is
      // a far worse bug than the stale tab this is fixing — and the same goes for
      // pulling the pack out from under the opening ceremony, which is three
      // cards in the air rather than one on a stand.
      if (revealingRef.current || openingRef.current) return;
      const next = todayKey();
      setDayKey((prev) => {
        if (prev === next) return prev;
        // The baseline effect keys on [collectionLoaded, collected], neither of
        // which changes at midnight — so nulling the baseline here would leave it
        // null forever, nextPack empty and the pack permanently un-openable.
        setPackBaseline(collected);
        return next;
      });
    }
    const id = setInterval(check, DAY_TICK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [collected]);

  /**
   * Snapshot the collection the pack is dealt against, once per person.
   *
   * Two things have to be true at the same time. It must not move while somebody
   * is revealing — `dealPack` swaps the last slot for a card they do not own, and
   * a baseline that shifted mid-reveal would re-deal it underneath them. And it
   * must not be somebody *else's*: a phone changes hands in this league, and a
   * write-once baseline meant the next person's guaranteed-new card was chosen
   * from the previous person's collection.
   *
   * So it is latched per identity rather than once, and `collectionLoaded` is
   * `mine.ready` — which is false until the server has reconciled, so the snapshot
   * is never taken from the unreconciled local store.
   */
  const baselineForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!identity) return;
    const somebodyNew = baselineForRef.current !== identity;
    if (!collectionLoaded) {
      // Their reconciliation is still out. Drop the previous person's snapshot
      // rather than deal against it: `nextPack` is empty without a baseline and
      // `tearOpen` refuses on an empty pack, so the wrapper simply is not
      // tearable for the beat it takes the server to answer. Holding the old one
      // would have dealt this person the guaranteed-new card that was new to
      // somebody else.
      if (somebodyNew) setPackBaseline(null);
      return;
    }
    setPackBaseline((prev) => (prev !== null && !somebodyNew ? prev : collected));
    baselineForRef.current = identity;
  }, [collectionLoaded, collected, identity]);

  // What today's pack *would* be if torn open right now — yours, and nobody
  // else's, because the seed carries who you are. See src/lib/pack.ts.
  const nextPack = useMemo(() => {
    const all = bundle?.participants ?? [];
    if (all.length === 0 || !packBaseline || !seed) return [];
    return dealPack(all, seed, packBaseline, PACK_SIZE);
  }, [bundle, seed, packBaseline]);

  // Once dealt, the stored ids are the pack. Re-deriving would drift: the last
  // slot depends on what was uncollected when the pack was opened.
  const pack = useMemo(() => {
    const all = bundle?.participants ?? [];
    if (!dealtIds) return nextPack;
    return dealtIds.map((id) => all.find((p) => p.id === id)).filter((p) => p != null);
  }, [bundle, dealtIds, nextPack]);

  const torn = dealtIds != null;
  const reduced = usePrefersReducedMotion();

  /**
   * Deal today's pack. Answers whether it did.
   *
   * The false case is the beat on arrival where the server has not reconciled the
   * collection yet: `nextPack` is empty without a baseline, so the wrapper is
   * simply not tearable for that beat. The ceremony has to hear about it, or it
   * plays a full production over a pack that was never dealt.
   */
  const tearOpen = useCallback((): boolean => {
    if (dealtIds || nextPack.length === 0) return false;
    const ids = nextPack.map((p) => p.id);
    // Dealt at the moment the rip commits rather than when the ceremony ends, so
    // the two round trips this unblocks — the daily secret's pull and the pack
    // recording, both keyed on `torn` below — get the ceremony's whole run as a
    // head start. The secret's own six-second timeout is the thing most likely to
    // make somebody wait, and this is two free seconds off it.
    setDealtIds(ids);
    revealedRef.current = [];
    replayedRef.current = new Set();
    resumedRef.current = false;
    setCursor(0);
    // The ceremony is the only thing the preference silences. Everything above is
    // the pack actually opening and happens either way.
    openingRef.current = !reduced;
    ceremonyRanRef.current = !reduced;
    setOpening(!reduced);
    playTear();
    return true;
  }, [dealtIds, nextPack, reduced]);

  const closeCeremony = useCallback(() => {
    openingRef.current = false;
    setOpening(false);
  }, []);

  async function revealAt(i: number) {
    // Both guards read refs, not state. A tap during the hit's hold, and a second
    // tap in the same tick as the first, are the two ways this used to run twice
    // over one card — and neither is visible in `revealed` yet.
    if (revealingRef.current || revealedRef.current.includes(i)) return;
    const ep = pack[i];
    if (!ep) return;
    const rarity = rarities.get(ep.id) ?? rarityStyle("base");
    const isHit = i === pack.length - 1;

    revealingRef.current = true;
    try {
      // Hold on the glowing edge before the hit lands. The pause is the whole trick.
      if (isHit) {
        setPeeking(true);
        await new Promise((r) => setTimeout(r, PEEK_MS));
        setPeeking(false);
      }

      revealedRef.current = [...revealedRef.current, i];
      setRevealed(revealedRef.current);
      playReveal(rarity.tier);
      // A migrated pack turns cards that were already pulled. Writing here would
      // charge somebody a second pull for a ceremony they were given, not asked
      // for. See replayedRef.
      if (!replayedRef.current.has(i)) {
        void collectCard(ep.id, rarity.tier);
        // Optimistic, and held apart from the reconciled collection: a card the
        // server has not vouched for is exactly what the merge would prune, so
        // without this it would light up as you flipped it and then vanish.
        //
        // The floor is counted from the snapshot the pack was dealt against, not
        // from whatever the collection holds now. `recordCardPulls` fires at tear
        // time and can answer before a card is turned over, and a floor derived
        // from the reconciled number then stacked this pull on top of the server's
        // own row for the rest of the session.
        //
        // On a resumed pack that recording already happened, in the session that
        // tore it — so for a member the snapshot itself contains this pull and
        // there is nothing to add. A guest has no server row either way, and their
        // local store only reaches this hook on mount, so they are still owed it.
        const held = packBaseline?.[ep.id]?.count ?? 0;
        const counted = resumedRef.current && !!me?.participantId;
        mine.markCollected(ep.id, rarity.tier, counted ? Math.max(held, 1) : held + 1);
      }

      if (rarity.tier === "champion" || rarity.tier === "podium") {
        await celebrate(rarity);
      }
    } finally {
      revealingRef.current = false;
    }
  }

  /**
   * The one-a-day card.
   *
   * Fired from an effect keyed on the torn pack and the member, rather than from
   * `tearOpen`. Not on mount, because reaching this route is one mis-tap from the
   * vault and must not spend the drop; not on tapping the card, because an
   * unbounded round trip racing the hold either stalls or lies; and not inside
   * `tearOpen`, because that misses the commonest first-timer path — a guest
   * tears the pack, hits the gate, goes to /claim, and comes back to the same
   * already-torn pack, where `tearOpen` will never run again.
   */
  useEffect(() => {
    if (!torn || !actor || pullFiredRef.current) return;
    pullFiredRef.current = true;
    setSecretPulling(true);
    setSecretFailed(false);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      // A row may still land server-side. That is fine: the retry re-reads the
      // day's pull rather than rolling a new one, so nothing is lost either way.
      setSecretPulling(false);
      setSecretFailed(true);
    }, SECRET_PULL_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await pull();
        settled = true;
        if (res.ok) {
          setSecret(res.card);
          setSecretDuplicate(res.duplicate);
          setSecretUnavailable(false);
          qc.invalidateQueries({ queryKey: secretStatusKey(actor) });
          qc.invalidateQueries({ queryKey: mySecretsKey(actor) });
        } else {
          // Nothing in the set yet, or every card still missing its art. Not a
          // failure to retry — there is genuinely nothing to hand over.
          setSecretUnavailable(true);
        }
        setSecretFailed(false);
      } catch (e) {
        settled = true;
        // The only place this app matches on an error string, justified because
        // the messages in require-auth.server.ts are explicitly contractual. A
        // token the server rejects is a token worth dropping, so the gate shows
        // instead of a retry that can never work.
        if (e instanceof Error && e.message.includes("Claim your player first")) {
          clearMemberToken();
        } else {
          setSecretFailed(true);
        }
      } finally {
        clearTimeout(timer);
        setSecretPulling(false);
      }
    })();

    return () => clearTimeout(timer);
  }, [torn, actor, pull, qc]);

  /**
   * Tell the server which cards were in this pack, so the vault can say how many
   * people have each one.
   *
   * Fired from an effect for the same reason the secret pull is: `tearOpen` misses
   * the commonest first-timer path, where a guest tears the pack, hits the claim
   * gate, goes to /claim and comes back to the same already-torn pack. Recorded on
   * tear rather than on reveal, because "packed by" means the card was in your
   * pack, not that you got round to tapping it.
   *
   * Fire-and-forget in both directions: a guest writes nothing, and a failure is
   * swallowed. A decorative count must never surface as an error on a screen
   * somebody is enjoying.
   */
  const recordedForRef = useRef<string | null>(null);
  useEffect(() => {
    const pid = me?.participantId;
    if (!torn || !dealtIds?.length || !pid) return;
    if (recordedForRef.current === pid) return;
    recordedForRef.current = pid;

    void (async () => {
      // Record only today's dealt cards. An earlier version also backfilled the
      // device's whole collection here so counts weren't zero on day one — but
      // in practice the first person to claim painted every card they'd ever
      // revealed with "Packed by 1", making the counter meaningless. Better an
      // honest ramp than a uniform stripe.
      const ids = dealtIds.slice(0, 16);
      try {
        // The same call records the pack itself. A pack of three cards you already
        // own writes no new card_pulls row, so counting packs from that table
        // would stop counting the moment somebody's collection filled up.
        //
        // No event is sent: the handler resolves the active one itself. A resumed
        // pack reaches here before the event query has answered, so passing it
        // from the client stamped a null and the latch above stopped it ever
        // being retried.
        await record({ data: { eventParticipantIds: ids } });
        await Promise.all([
          qc.invalidateQueries({ queryKey: cardPullCountsKey(event?.id) }),
          qc.invalidateQueries({ queryKey: myCardStatsKey(event?.id, pid) }),
        ]);
      } catch {
        /* a count nobody asked for is not worth an error nobody can act on */
      }
    })();
  }, [torn, dealtIds, me?.participantId, record, qc, event?.id]);

  // A phone changing hands mid-party is a real thing in this league. Re-arm the
  // latch when the member changes so the next person gets their own card.
  useEffect(() => {
    pullFiredRef.current = false;
    recordedForRef.current = null;
    setSecret(null);
    setSecretRevealed(false);
    setSecretFailed(false);
    setSecretUnavailable(false);
  }, [actor]);

  // The drop rolls over on the *server's* day, not this device's. Guarded on the
  // first observed value, or this would clobber the secretRevealed that the
  // resume effect has just restored from IndexedDB.
  const serverDayRef = useRef<string | null>(null);
  useEffect(() => {
    const day = status.data?.day ?? null;
    if (!day) return;
    if (serverDayRef.current && serverDayRef.current !== day) {
      pullFiredRef.current = false;
      setSecret(null);
      setSecretRevealed(false);
    }
    serverDayRef.current = day;
  }, [status.data?.day]);

  const secretRarity = secretFoil(secret?.foil);

  async function revealSecret() {
    // revealingRef first: the secret holds for 1600ms before it turns, and
    // `secretRevealed` is still false for every one of them.
    if (revealingRef.current || !secret || secretRevealed) return;
    revealingRef.current = true;
    try {
      // A duplicate you have seen three times does not need the full production.
      const ceremony = !secretDuplicate || (status.data?.pulled ?? 0) <= DUPE_CEREMONY_LIMIT;
      if (ceremony) {
        setSecretPeeking(true);
        await new Promise((r) => setTimeout(r, SECRET_RISER_AT_MS));
        playSecretRiser(0.9);
        await new Promise((r) => setTimeout(r, SECRET_PEEK_MS - SECRET_RISER_AT_MS));
        setSecretPeeking(false);
      }

      setSecretRevealed(true);
      // Not a tier: SECRET_RARITY carries tier "base" so it satisfies the type,
      // and nothing may branch on that. The chime is named explicitly.
      playReveal(secretDuplicate ? SECRET_DUPE_CHIME : SECRET_CHIME);
      if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        navigator.vibrate?.([10, 60, 10, 60, 26]);
      }
      // A duplicate gets the shimmer, never a second burst — a wink, not a parade.
      if (!secretDuplicate) await celebrateSecret(secretRarity);
    } finally {
      revealingRef.current = false;
    }
  }

  // Written on every step rather than only on tear, so a phone that loses the tab
  // mid-reveal comes back to the cards it had already flipped.
  useEffect(() => {
    if (!dealtIds || !stateLoaded) return;
    void savePackState({
      dayKey,
      ids: dealtIds,
      revealed,
      secretRevealed,
      identity: identity ?? undefined,
      cursor,
    });
  }, [dealtIds, dayKey, revealed, secretRevealed, stateLoaded, identity, cursor]);

  const secretSlot: SecretSlot = !torn
    ? "hidden"
    : // No identity yet means the guest session is still in flight, so this is a
      // blank slot for a beat rather than a wall. Guests get the card.
      !actor
      ? "pending"
      : secret
        ? secretRevealed
          ? "open"
          : "sealed"
        : secretUnavailable
          ? "hidden"
          : secretFailed
            ? "failed"
            : secretPulling
              ? "pending"
              : "hidden";

  const stage = packStage({ torn, opening, packSize: pack.length, cursor, secretSlot });
  const onSecretStep = cursor >= pack.length;

  /**
   * Wait for a pull that is still in the air.
   *
   * Reads refs rather than the closure, which is already stale by the time the
   * roster sequence has finished awaiting three cards. Bounded by the pull's own
   * timeout, which flips it to `failed` and clears `secretPulling`, so this
   * cannot outlive the request it is waiting on.
   */
  async function settledSecret(): Promise<SecretCardView | null> {
    const deadline = Date.now() + SECRET_PULL_TIMEOUT_MS;
    while (!secretRef.current && pullingRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
    return secretRef.current;
  }

  /**
   * Turn every card, in order, without waiting for a tap between them.
   *
   * Kept sequential: the chimes are tuned to land one after another, and firing
   * them together stacks into noise. The secret goes last or its hold lands
   * underneath the hit's and neither of them reads.
   */
  async function revealEverything() {
    // Two taps used to start two sequences over the same cards, each collecting
    // and celebrating them again.
    if (autoRef.current) return;
    autoRef.current = true;
    setAutoRunning(true);
    try {
      for (let i = cursor; i < pack.length; i++) {
        setCursor(i);
        // Let the card arrive face-down and paint before it turns. Without this
        // the cursor move and the reveal batch into one render, so the stand
        // mounts the next card already face-up and the flip — the thing being
        // animated — is skipped for every card the sequence advances to.
        await new Promise((r) => setTimeout(r, AUTO_MOUNT_MS));
        await revealAt(i);
        await new Promise((r) => setTimeout(r, AUTO_STEP_MS));
      }
      setCursor(pack.length);
      // A pull that was still in flight when the button was pressed has had
      // three cards' worth of time to land by now. Reading the closure's stale
      // `secret` left the run stranded on a sealed card the user then had to tap.
      if (!(await settledSecret())) return;
      await new Promise((r) => setTimeout(r, AUTO_MOUNT_MS));
      await revealSecret();
      await new Promise((r) => setTimeout(r, AUTO_STEP_MS));
      setCursor(pack.length + 1);
    } finally {
      autoRef.current = false;
      setAutoRunning(false);
    }
  }

  // Warm the art for the card on the stand and the one behind it. A flip that
  // lands on a half-decoded image is the one failure the ceremony cannot absorb,
  // and nothing else in the app preloads — the vault grid can afford to stream in
  // because nothing there is a surprise.
  useEffect(() => {
    // Started during the ceremony, not when the stand appears. The pack is dealt
    // the instant the rip commits, so the first two fronts get the whole opening
    // to fetch and decode in — which is exactly the head start this comment used
    // to say the flip could not do without.
    if (stage !== "revealing" && stage !== "opening") return;
    for (const ep of [pack[cursor], pack[cursor + 1]]) {
      if (ep) void preloadCard(cards.data?.[ep.id]?.front ?? null);
    }
    if (secret?.artUrl) void preloadCard(secret.artUrl);
  }, [stage, cursor, pack, cards.data, secret?.artUrl]);

  const collectedCount = mine.collectedCount;
  const total = bundle?.participants.length ?? 0;

  // The sealed pack must not flash on a day already opened, so nothing renders
  // until the stored state has been read.
  //
  // The second condition covers a reload: the dealt ids come back from IndexedDB
  // well before the roster query resolves, and for those frames `pack` is empty.
  // Rendering the stage off that would step straight past a stand with nothing on
  // it and flash "Pack Complete" over an empty grid.
  if (!stateLoaded || (torn && pack.length === 0)) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Folded away for the ceremony. A phone screen is short, and this row is
            90px of running total above a card whose whole job is to be the biggest
            thing on it — with the bar in place the Next button falls below the
            fold. It comes back with the finished pack, which is where a collection
            counter belongs anyway. */}
        {stage !== "revealing" && (
          <div className="mb-5 flex items-center justify-between border-b border-primary/20 pb-4">
            <Link
              to="/players"
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.3em] text-primary hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Vault
            </Link>
            <div className="text-right">
              <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                Collected
              </div>
              {/* Dashed until reconciled — this counter used to read the whole
                  roster off a local store the old collect-on-sight write had filled. */}
              <div className="font-display text-lg font-black text-primary">
                {mine.ready ? `${collectedCount} / ${total}` : `— / ${total}`}
              </div>
            </div>
          </div>
        )}

        {stage === "sealed" || stage === "opening" ? (
          <div className="flex flex-col items-center gap-5 py-6">
            {/* Faded rather than unmounted. Removing the copy at the moment the
                rip commits reflows the pack upward on the exact frame the tear is
                meant to be the only thing moving. */}
            <motion.div
              className="text-center"
              animate={{ opacity: stage === "opening" ? 0.12 : 1 }}
              transition={{ duration: 0.3 }}
            >
              <h1 className="font-display text-3xl font-black uppercase leading-none">
                Today&apos;s Pack
              </h1>
              <p className="mt-2 max-w-sm text-xs text-muted-foreground">
                One pack a day, dealt to you and nobody else. Refreshing won&apos;t reroll it — rip
                the top off to open it.
              </p>
            </motion.div>

            <PackOpening
              seed={seed ?? ""}
              artUrl={packBack.data?.urls ?? null}
              packSize={PACK_SIZE}
              year={String(event?.year ?? "")}
              slots={PACK_SIZE}
              onTear={tearOpen}
              onDone={closeCeremony}
            />

            <motion.div
              className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground"
              animate={{ opacity: stage === "opening" ? 0 : 1 }}
              transition={{ duration: 0.2 }}
            >
              Drag across the tear · or press Enter
            </motion.div>
          </div>
        ) : stage === "revealing" ? (
          <div className="space-y-3">
            <div className="text-center">
              <h1 className="font-display text-lg font-black uppercase leading-none">
                Tap to Reveal
              </h1>
            </div>

            <PackStand
              pack={pack}
              bundle={bundle}
              cursor={cursor}
              cards={cards.data}
              rarities={rarities}
              revealed={revealed}
              universalBack={urlFromSet(packBack.data?.urls) ? (packBack.data?.urls ?? null) : null}
              pullCounts={pullCounts.data}
              secretSlot={secretSlot}
              secret={secret}
              secretRarity={secretRarity}
              secretRevealed={secretRevealed}
              secretDuplicate={secretDuplicate}
              secretPeeking={secretPeeking}
              peeking={peeking}
              busy={autoRunning}
              fromPack={ceremonyRanRef.current}
              onReveal={(i) => void revealAt(i)}
              onRevealSecret={() => void revealSecret()}
              onAdvance={() => setCursor((c) => c + 1)}
            />

            {/* Kept off the secret's step: an escape hatch under the one card the
                whole sequence is building to reads as a way past it. */}
            {!onSecretStep && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => void revealEverything()}
                  disabled={autoRunning}
                  className="rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-muted-foreground"
                >
                  Reveal all
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="font-display text-2xl font-black uppercase leading-none">
                Pack Complete
              </h1>
            </div>

            {/* One row of three, deliberately small. The fourth slot below is the
                payoff and has to be reachable without a long scroll on a phone,
                so the roster trio reads as the supporting row rather than
                competing with it for height. */}
            <div className="mx-auto grid max-w-sm grid-cols-3 items-start gap-2 sm:max-w-lg sm:gap-3">
              {pack.map((ep, i) => {
                const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
                const isRevealed = revealed.includes(i);
                const name = ep.participant?.name ?? "—";
                return (
                  <div key={ep.id} className="flex flex-col gap-1">
                    {/* The card owns its own button semantics — wrapping it in
                        another button would nest interactive elements.
                        The layout id is shared with the stand, so the card flies
                        from where it was examined into its column rather than
                        appearing there. */}
                    <motion.div
                      layoutId={`pack-card-${ep.id}`}
                      transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 28,
                        delay: i * 0.06,
                      }}
                      className="rounded-xl"
                    >
                      <HoloCard
                        frontUrl={cards.data?.[ep.id]?.front ?? null}
                        backUrl={cards.data?.[ep.id]?.back ?? null}
                        name={name}
                        rarity={rarity}
                        cacheKey={ep.id}
                        backContent={<CardBackPanel ep={ep} bundle={bundle} rarity={rarity} />}
                      />
                    </motion.div>
                    <AnimatePresence>
                      {isRevealed && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-center"
                        >
                          {/* Two lines at most: at three-up the column is narrow,
                              and the grid's items-start absorbs uneven rows. */}
                          <Link
                            to="/players/$id"
                            params={{ id: ep.id }}
                            className="block line-clamp-2 font-display text-[11px] font-black uppercase leading-tight tracking-wide hover:text-primary sm:text-sm"
                          >
                            {name}
                          </Link>
                          {/* accent, not border: base and dnf set border to a
                              near-transparent white so their bezel vanishes,
                              which left this label all but unreadable. Same
                              reason CardBackPanel does it. */}
                          <div
                            className="text-[9px] font-bold uppercase tracking-[0.2em] sm:text-[10px]"
                            style={{ color: rarity.accent }}
                          >
                            {rarity.label}
                          </div>
                          {/* Muted and on its own line: the tier above is what
                              this card is, this is how many people have one. */}
                          {packedByLabel(pullCounts.data?.[ep.id]) && (
                            <div className="text-[8px] font-bold uppercase leading-tight tracking-[0.15em] text-muted-foreground sm:text-[9px]">
                              {packedByLabel(pullCounts.data?.[ep.id])}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            <SecretSlotView
              slot={secretSlot}
              card={secret}
              rarity={secretRarity}
              duplicate={secretDuplicate}
              pulledCount={status.data?.pulled ?? 0}
              universalBack={urlFromSet(packBack.data?.urls) ? (packBack.data?.urls ?? null) : null}
              onRetry={() => {
                pullFiredRef.current = false;
                setSecretFailed(false);
                // Flipping this back off re-runs the pull effect, whose latch was
                // just cleared.
                setSecretPulling(false);
              }}
            />

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Link to="/players" className="neon-btn !px-4 !py-2 !text-xs">
                <PackageOpen className="h-4 w-4" />
                Back to the vault
              </Link>
            </div>

            <p className="text-center text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              {secretSlot === "open"
                ? "That's today's pack, secret and all — come back tomorrow"
                : "That's today's pack — come back tomorrow"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
