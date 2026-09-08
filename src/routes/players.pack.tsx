import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEnsureGuestSession } from "@/hooks/use-guest-session";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { mySecretsKey, useMySecrets, useSecretActor } from "@/hooks/use-daily-secret";
import { packStatusKey, usePackStatus } from "@/hooks/use-pack-status";
import { PackOpening } from "@/components/pack-opening";
import { PackStand, type StandSlot } from "@/components/pack-stand";
import { PresentationMode, PresentationStage } from "@/components/presentation-mode";
import { PackSummary } from "@/components/pack-summary";
import { SoundToggle } from "@/components/sound-toggle";
import { StreakFlame } from "@/components/streak-flame";
import { MilestoneReveal } from "@/components/milestone-reveal";
import { CollectionComplete } from "@/components/collection-complete";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { markTrophiesCelebrated, trophyKey } from "@/lib/trophy-seen";
import type { CompletedCollection } from "@/lib/collection-trophies";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import {
  addUnrecorded,
  clearPackDealt,
  collectCard,
  loadPackState,
  packDealtElsewhere,
  PACK_STATE_CHANGED,
  retireUnrecorded,
  savePackState,
  todayKey,
  PACK_DEALT_KEY,
  type PackSlotRef,
} from "@/lib/card-collection";
import { myCardStatsKey, useMyCollection } from "@/hooks/use-my-collection";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { playReveal, playSecretRiser, playTear } from "@/lib/card-sfx";
import { celebrate, celebrateSecret, celebrateUpgrade } from "@/lib/card-confetti";
import { openPack } from "@/lib/pack.functions";
import { adoptCollection } from "@/lib/card-pulls.functions";
import { secretFoil, SECRET_CHIME, SECRET_DUPE_CHIME } from "@/lib/secret-cards";
import { clearMemberToken, useMemberSession } from "@/lib/member-token";
import { deviceId, usePackIdentity } from "@/lib/device-id";
import { packStage, type PackSlot } from "@/lib/pack";
import {
  celebrationFor,
  copiesAfter,
  peekMs,
  SECRET_RISER_AT_MS,
  slotOutcome,
  upgradeLabel,
  type LocalBefore,
} from "@/lib/pack-outcome";
import { editionStyle, toEdition } from "@/lib/card-edition";
import { dustLive, MILL_BY_EDITION, secretSellValue } from "@/lib/dust";
import { secretTierStyle } from "@/lib/secret-rarity";
import type { PackHandoff } from "@/lib/pack-handoff";
import { preloadCard } from "@/lib/preload";
import { streakStatusKey, useStreakStatus } from "@/hooks/use-streak";
import { useMilestoneClaim } from "@/hooks/use-milestone-claim";
import { streakLine } from "@/lib/streaks";
import { cardPullCountsKey, useCardPullCounts } from "@/hooks/use-card-pulls";
import { urlFromSet } from "@/lib/media";
import { CollectorSignupGate } from "@/components/collector-signup";
import { FeedDegradedBanner, FeedError } from "@/components/feed-state";

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
      { property: "og:description", content: "Three cards. Any of them could be a secret." },
    ],
  }),
  component: PackPage,
});

/** How many cards the wrapper shows flying out. The server deals exactly this many. */
const PACK_SIZE = 3;

/**
 * The gap between a secret's own burst and the set closing behind it.
 *
 * Long enough that the two read as consequence rather than as one noise: the
 * card's confetti is still in the air when this starts, and the ear has to have
 * finished the secret chime before the resolving one lands on top of it.
 */
const COMPLETION_BEAT_MS = 900;
/**
 * How long the deal is allowed to take before the screen admits it has stalled.
 *
 * Short on purpose: staring at a sealed wrapper while your friends look at their
 * cards is worse than a retry tap. Giving up does not cancel the request — the
 * row may still land — which is exactly why the server answers the same pack
 * back on the retry rather than dealing a second one.
 */
const OPEN_TIMEOUT_MS = 8_000;
/** Full ceremony for the first few duplicate secrets; after that it is a tax. */
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
/**
 * How long to hold a guest's pack while a claim in another tab carries it.
 *
 * The token lands a whole network round trip before `carryPackToIdentity` does,
 * and re-sealing in between is what lets a second pack be dealt over the one
 * being carried. Generous, because the wait costs nothing but a pack staying on
 * screen — and bounded, because a claim on a tab running an older bundle never
 * carries anything at all, and a pack that waits forever is worse than a second
 * one.
 */
const CARRY_GRACE_MS = 20_000;

/** Why the screen is asking the server for a pack. */
type OpenRequest = {
  /** A tear deals; a resume re-reads today's pack for its fresh signed art. */
  kind: "tear" | "resume";
  /** Bumped by the retry button, so an identical request still re-runs the effect. */
  nonce: number;
};

/** The one slot ref the row stores per card, from a dealt slot. */
function slotRef(slot: PackSlot, local: LocalBefore | undefined): PackSlotRef {
  const ref: PackSlotRef = { kind: slot.kind, id: slot.id };
  if (local) {
    ref.heldBefore = local.heldBefore;
    if (local.editionBefore) ref.editionBefore = local.editionBefore;
  }
  return ref;
}

function PackPage() {
  const { event, bundle, error, failedTables, realtimeDegraded, refetch } = useEventBundle();
  // A read that failed, as opposed to one still on its way — and all three ways
  // it can fail, because every one of them ends with no roster to draw the cards
  // on screen from. The event can be missing, the bundle query can reject, or
  // the bundle can come back fine with the roster table coalesced to `[]` —
  // which is the case `failed` exists to name, and the one an error check alone
  // cannot see. This is both what unblocks `useMyCollection` below and what the
  // render bails out on.
  const eventFailed =
    (!!error && (!event || !bundle)) || failedTables.includes("event_participants");
  const cards = useEventCardUrls(event?.id ?? null);
  // The event's back, never a player's — see the note on useEventCardBack. The
  // wrapper is shown before anything has been dealt, so a per-player back here
  // would be the reveal, printed on the outside of the pack.
  const packBack = useEventCardBack(event?.id ?? null);
  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  // Reconciled against the server rather than read straight off this device.
  // For a member the server is the collection; for a guest the local store is,
  // and it is what the ribbon counts a guest's pulls against.
  const rosterIds = useMemo(() => (bundle?.participants ?? []).map((p) => p.id), [bundle]);
  const mine = useMyCollection(event?.id ?? null, rosterIds, eventFailed);
  const collected = mine.collection;
  const collectionLoaded = mine.ready;

  /**
   * Today's pack, as the server dealt it. Null means nothing is on screen yet:
   * the wrapper is still sealed, or a request is in the air. `stateLoaded`
   * tracks undefined-until-loaded separately, so the sealed pack never flashes
   * on a day that has already been opened.
   */
  const [slots, setSlots] = useState<PackSlot[] | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  /** Which slot is holding on its glowing edge, or null for none. */
  const [peeking, setPeeking] = useState<number | null>(null);
  /**
   * The opening ceremony is playing.
   *
   * Set only by `tearOpen`, never by the resume path: coming back to a pack you
   * already tore should land you on the card you were looking at, not replay the
   * production. A payoff, not a toll.
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
  /**
   * Where the ceremony left its deck, for the stand to pick up.
   *
   * Not a stage. `packStage` still steps straight from "opening" to "revealing";
   * by the time this is set the stand genuinely owns the screen and is simply
   * still arriving. Null for all but a few hundred milliseconds a day, and null
   * outright for a skip or under reduced motion.
   */
  const [entering, setEntering] = useState<PackHandoff | null>(null);
  // Which card is on the stand. Advanced only by the user: revealing a card does
  // not move it on, because a card you have not looked at yet is not a card you
  // are finished with.
  const [cursor, setCursor] = useState(0);

  const me = useMemberSession();
  const qc = useQueryClient();
  const open = useServerFn(openPack);
  const adopt = useServerFn(adoptCollection);
  const pullCounts = useCardPullCounts(event?.id ?? null);
  // A guest gets an identity minted for them the moment they land here, so the
  // pack is theirs rather than a locked wrapper. Only for the unclaimed — a
  // member already has one.
  useEnsureGuestSession(true);
  const actor = useSecretActor();
  const streakQuery = useStreakStatus(actor);
  const status = usePackStatus(actor);
  const mySecrets = useMySecrets(actor);

  /**
   * The request in flight, or the one that failed and is waiting on a retry.
   *
   * State rather than a call from `tearOpen`, and for the same reason the old
   * secret pull was an effect: the commonest first-timer path is a guest who
   * tears the pack, hits the claim gate, goes to /claim and comes back to the
   * same already-torn pack, where `tearOpen` will never run again. A resume
   * asks too — a secret's art is signed and expires, and only the server has
   * fresh URLs for it.
   */
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const [openState, setOpenState] = useState<"idle" | "pending" | "failed" | "unavailable">("idle");
  /** Which request has been sent, so a re-render cannot send it twice. */
  const openFiredRef = useRef<string | null>(null);
  /** The slot ids the stored row named, for a resume to check the answer against. */
  const storedIdsRef = useRef<string[]>([]);
  /**
   * A guest's collection as it stood when the pack was dealt, by card id.
   *
   * The server answers "held before" for a member off its own ledger and says
   * nothing for a guest, whose collection lives on this phone. Snapshotted at
   * the deal and persisted on the row's slots, so the ribbon reads the same on
   * every load rather than counting a card the reveal has just written.
   */
  const [localBefore, setLocalBefore] = useState<Record<string, LocalBefore>>({});
  /**
   * Slots whose set-complete ceremony is still owed.
   *
   * Parked rather than fired on arrival because the order is the whole point:
   * you see WHICH card it was, and only then find out it was the last one. Fired
   * at the end of `revealAt`. A ref beside the state because `revealAt` is a
   * plain function re-made every render — reached through a stale closure it
   * would swallow the one ceremony this feature exists for — and state because
   * the save effect has to persist it across the reload that used to lose it.
   */
  const pendingCompletionsRef = useRef<number[]>([]);
  const [pendingCompletions, setPendingCompletions] = useState<number[]>([]);
  const [completion, setCompletion] = useState<CompletedCollection | null>(null);
  /**
   * A ceremony is running.
   *
   * Also the re-entrancy latch. A card holds for 900ms (1600ms for a secret)
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
  /** Set while "Reveal all" owns the sequence, so nothing else can drive it. */
  const autoRef = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);

  // The pack's day is the league's — see `todayKey`. The server's answer, when
  // it has one, wins over this phone's idea of it.
  const [dayKey, setDayKey] = useState(todayKey);
  // Null until the browser has answered. Nothing is dealt against a half-known
  // identity, or a claimed member would flash a device-seeded pack first.
  const identity = usePackIdentity();

  /**
   * The pack on screen was dealt to a guest and carried across by a claim.
   *
   * Read by the reveal, which files the cards the claim's adoption never saw,
   * and by nothing else. A ref rather than state: it is read from inside a
   * function keyed on other things, and nothing renders it.
   */
  const carriedFromRef = useRef<string | null>(null);
  /**
   * Which of the carried pack's cards the claim's adoption already filed.
   *
   * Never assume the whole pack: `collectCard` runs inside the reveal, so a guest
   * who claims with cards still face-down has those in no snapshot and adoption
   * never heard about them. The reveal files exactly the rest, one by one.
   */
  const carriedAdoptedRef = useRef<string[]>([]);
  /**
   * The identity `slots` were actually dealt to.
   *
   * `identity` moves under a pack that is already on screen — a claim in another
   * tab, the 90-day token expiring on the hourly tick — and the resume load that
   * re-seals is always a beat behind it, because it is asynchronous and the
   * effects keyed on the new identity are not. For that beat the cards in hand
   * belong to somebody else, and the save effect below would file them under
   * whoever the phone is now.
   */
  const dealtForRef = useRef<string | null>(null);
  /**
   * The league day `slots` were dealt on.
   *
   * `dayKey` moves on the day tick, a render before the resume load can answer
   * with the new day's row — so for that render the cards in hand are
   * yesterday's while everything keyed on the day says today, and saving them
   * then would rewrite the row to claim yesterday's cards are today's pack.
   */
  const dealtOnRef = useRef<string | null>(null);
  /**
   * A claim in another tab is carrying this pack across right now.
   *
   * Read by `tearOpen`, which must not deal a replacement over a pack that is
   * about to arrive under this identity.
   */
  const awaitingCarryRef = useRef(false);
  /** When this tab stops waiting for that carry. Fixed once, so a re-run cannot push it out. */
  const carryDeadlineRef = useRef<number | null>(null);
  /**
   * Re-run the resume load without waiting for `dayKey` or `identity` to move.
   *
   * Two things need that. Another tab tearing the pack, which reaches this one
   * as a `storage` event and nothing else; and an identity change that arrived
   * while a card was mid-flip, which is deferred below rather than acted on.
   */
  const [resumeNonce, setResumeNonce] = useState(0);
  /**
   * A resume the guard below has held back, waiting for the screen to be still.
   *
   * The day tick refuses to re-seal a pack under somebody's thumb; this effect
   * had no such guard, so any identity flip mid-reveal nulled the pack and the
   * cards vanished under their finger. Reachable from a claim in another tab,
   * the 90-day token expiring on the hourly tick, and this screen's own
   * `clearMemberToken()` when the deal answers "Claim your player first".
   */
  const resumeDeferredRef = useRef(false);

  /**
   * Act on a deferred identity change, now that nothing is in the air.
   *
   * Called from every `finally` that hands `revealingRef` back and from the
   * ceremony's own close — those are the places the guard above can stop being
   * true, and a deferral that outlives all of them is a pack that never
   * re-seals.
   */
  const releaseDeferredResume = useCallback(() => {
    if (!resumeDeferredRef.current) return;
    resumeDeferredRef.current = false;
    setResumeNonce((n) => n + 1);
  }, []);

  /** Everything a fresh wrapper starts from, and everything a re-seal clears. */
  const resetPack = useCallback(() => {
    setSlots(null);
    setOpenRequest(null);
    setOpenState("idle");
    openFiredRef.current = null;
    revealedRef.current = [];
    setRevealed([]);
    setCursor(0);
    setPeeking(null);
    setLocalBefore({});
    pendingCompletionsRef.current = [];
    setPendingCompletions([]);
    carriedFromRef.current = null;
    carriedAdoptedRef.current = [];
    dealtForRef.current = null;
    dealtOnRef.current = null;
  }, []);

  // One pack a day, so a return visit resumes rather than deals. Yesterday's row
  // is simply ignored — the next tear overwrites it.
  useEffect(() => {
    // Wait for the browser to answer who this pack is for. usePackIdentity
    // returns null for one render on every mount while it reads localStorage,
    // and running the load then would compare a stored `d:xxx` against `null`,
    // decide the pack isn't mine, and clear it — briefly rendering a tearable
    // sealed pack that a fast tap can deal straight over the saved one.
    if (identity == null) return;
    // The day tick's guard, which this effect went without. Deferred rather than
    // dropped: whoever the pack now belongs to, the cards already on the stand
    // finish their reveal first and the re-seal happens after.
    if (revealingRef.current || openingRef.current) {
      resumeDeferredRef.current = true;
      return;
    }
    let cancelled = false;
    let graceTimer: number | undefined;
    // Cleared first so the rollover below cannot write today's key over
    // yesterday's cards in the window before this resolves.
    setStateLoaded(false);
    loadPackState().then((s) => {
      if (cancelled) return;
      // A claim in another tab is carrying this pack across right now.
      //
      // `setMemberToken` flips this tab's identity the instant the token is
      // written, which is a whole network round trip before the carry rewrites
      // the row. Re-sealing in that window takes the cards off the screen and
      // lets a fast tap deal a second pack over the one being carried. So an
      // upgrade from THIS DEVICE's own guest identity waits: the pack stays
      // exactly where it is, nothing is saved under the new name (the save
      // effect checks `dealtForRef`), and the carry's own write to the mirror
      // brings us back here with the row it expects.
      const device = deviceId();
      const carrying =
        !!s &&
        s.dayKey === dayKey &&
        !!device &&
        s.identity === `d:${device}` &&
        identity.startsWith("m:");
      if (carrying) {
        carryDeadlineRef.current ??= Date.now() + CARRY_GRACE_MS;
        const left = carryDeadlineRef.current - Date.now();
        if (left > 0) {
          awaitingCarryRef.current = true;
          graceTimer = window.setTimeout(() => setResumeNonce((n) => n + 1), left);
          setStateLoaded(true);
          return;
        }
      }
      awaitingCarryRef.current = false;
      // A stored row without an identity predates per-person packs; treat it
      // as a match. A row without `cards` was written before the server dealt
      // packs, and is not today's pack: the server either resumes today's or
      // deals it, and either way the row is rewritten.
      const mine = s?.identity == null || s.identity === identity;
      if (s && s.dayKey === dayKey && mine && s.cards && s.cards.length > 0) {
        revealedRef.current = s.revealed;
        setRevealed(s.revealed);
        // Come back to the card you were on, not to the start.
        setCursor(s.cursor ?? s.revealed.length);
        carriedFromRef.current = s.carriedFrom ?? null;
        carriedAdoptedRef.current = s.carriedAdopted ?? [];
        dealtForRef.current = s.identity ?? identity;
        dealtOnRef.current = s.dayKey;
        const before: Record<string, LocalBefore> = {};
        for (const c of s.cards) {
          if (c.heldBefore != null) {
            before[c.id] = { heldBefore: c.heldBefore, editionBefore: c.editionBefore ?? null };
          }
        }
        setLocalBefore(before);
        storedIdsRef.current = s.cards.map((c) => c.id);
        pendingCompletionsRef.current = s.pendingCompletions ?? [];
        setPendingCompletions(s.pendingCompletions ?? []);
        // The cards themselves come from the server: a secret's art is signed
        // and expires, and only the server has fresh URLs. The row's slots are
        // what the answer is checked against.
        setSlots(null);
        setOpenState("pending");
        openFiredRef.current = null;
        setOpenRequest({ kind: "resume", nonce: 0 });
      } else {
        resetPack();
        // The stored row is not this person's pack for today, so neither is the
        // mirror. This is the only place a mirror that outlived its row is ever
        // cleaned up — which is why one that somehow survives can cost at most a
        // single refused tap rather than the day's pack.
        clearPackDealt(dayKey, identity);
      }
      setStateLoaded(true);
    });
    return () => {
      cancelled = true;
      if (graceTimer) window.clearTimeout(graceTimer);
    };
  }, [dayKey, identity, resumeNonce, resetPack]);

  // A different identity waits its own grace, not the leftovers of the last one's.
  useEffect(() => {
    carryDeadlineRef.current = null;
    awaitingCarryRef.current = false;
  }, [identity]);

  // Another tab tore the pack. IndexedDB says nothing across tabs, so the mirror
  // beside it is the only signal this one gets — and without it a tab left on a
  // sealed wrapper stayed sealed, then asked for the same pack over the other
  // tab's reveal progress when somebody eventually tapped it.
  useEffect(() => {
    const theirs = (e: StorageEvent) => {
      if (e.key !== null && e.key !== PACK_DEALT_KEY) return;
      setResumeNonce((n) => n + 1);
    };
    // And a carry in THIS tab, which `storage` never reports — a sign-in runs
    // `useAccountSync` right here, so the pack the hold below is waiting for can
    // arrive without a single cross-tab event. Gated on the hold rather than
    // listened to always: this fires on every write to the pack row, and outside
    // the hold that is our own save on every card turned.
    const ours = () => {
      if (awaitingCarryRef.current) setResumeNonce((n) => n + 1);
    };
    window.addEventListener("storage", theirs);
    window.addEventListener(PACK_STATE_CHANGED, ours);
    return () => {
      window.removeEventListener("storage", theirs);
      window.removeEventListener(PACK_STATE_CHANGED, ours);
    };
  }, []);

  // A tab left open past midnight used to sit on yesterday's pack forever.
  // Polled rather than scheduled, because a phone suspends timers the moment the
  // screen goes dark.
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
        // The server's own view of the day, refreshed with it.
        void qc.invalidateQueries({ queryKey: packStatusKey(actor) });
        return next;
      });
    }
    const id = setInterval(check, DAY_TICK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [qc, actor]);

  /**
   * The server's day beats this phone's, while nothing is on the stand.
   *
   * They agree everywhere except on a phone whose clock is wrong, and there the
   * server's answer is the one the pack will actually be keyed on. Only while
   * sealed: moving the day under a dealt pack would re-seal it.
   */
  useEffect(() => {
    const day = status.data?.day;
    if (!day || slots != null || openRequest != null) return;
    setDayKey((prev) => (prev === day ? prev : day));
  }, [status.data?.day, slots, openRequest]);

  const torn = slots != null || openRequest != null;
  const reduced = usePrefersReducedMotion();

  /**
   * Whether the wrapper can be torn right now.
   *
   * The server has to know the day (so the row is keyed right), the guest
   * session has to exist (so there is somebody to deal to), the bundle has to
   * have answered (so the cards dealt can be drawn), and the collection has to
   * be reconciled (so a guest's "held before" snapshot is honest). The
   * Collected counter's dash is what says the last of those out loud.
   *
   * NOT the roster having anybody on it. The server deals from the secrets
   * alone when the event has no roster yet, and a gate here would keep a pack
   * the server is willing to deal from ever being asked for.
   */
  const canTear = !torn && !!identity && !!actor && !!status.data && !!bundle && collectionLoaded;

  /**
   * Tear today's pack. Answers whether it did.
   *
   * The false case is the beat on arrival where the server has not answered the
   * status or the collection is not reconciled yet: the wrapper is simply not
   * tearable for that beat. The ceremony has to hear about it, or it plays a
   * full production over a pack that was never dealt.
   */
  const tearOpen = useCallback((): boolean => {
    if (!canTear || !identity) return false;
    // A pack of this device's is on its way over from a claim in another tab.
    // Dealing now would put a second one on top of it. The resume load comes back
    // on its own when the carry lands, or when it gives up waiting.
    if (awaitingCarryRef.current) return false;
    // Another tab already tore this pack. `slots` above only knows about this
    // one, and IndexedDB fires no cross-tab event — so without the mirror a
    // second tab asked for the same pack and wrote `revealed: []` and `cursor: 0`
    // over the first tab's progress. Refused rather than merged, and the resume
    // load is nudged so this tab picks the other's row up instead of sitting sealed.
    if (packDealtElsewhere(dayKey, identity)) {
      setResumeNonce((n) => n + 1);
      return false;
    }
    // Asked for at the moment the rip commits rather than when the ceremony
    // ends, so the round trip gets the ceremony's whole run as a head start.
    revealedRef.current = [];
    setRevealed([]);
    setCursor(0);
    carriedFromRef.current = null;
    carriedAdoptedRef.current = [];
    dealtForRef.current = identity;
    dealtOnRef.current = dayKey;
    pendingCompletionsRef.current = [];
    setPendingCompletions([]);
    setOpenState("pending");
    openFiredRef.current = null;
    setOpenRequest({ kind: "tear", nonce: 0 });
    // The ceremony is the only thing the preference silences. Everything above is
    // the pack actually opening and happens either way.
    openingRef.current = !reduced;
    ceremonyRanRef.current = !reduced;
    setOpening(!reduced);
    playTear();
    return true;
  }, [canTear, identity, dayKey, reduced]);

  const closeCeremony = useCallback(
    (from: PackHandoff | null) => {
      openingRef.current = false;
      setEntering(from);
      setOpening(false);
      // One of the moments the resume guard stops holding. Three cards in the
      // air is the worst thing to re-seal under, so an identity that changed
      // during the ceremony has been waiting for exactly this.
      releaseDeferredResume();
    },
    [releaseDeferredResume],
  );

  // The actor behind a request is live — a phone can change hands while one is
  // in the air. The middleware reads whatever token localStorage holds at send
  // time, so a late answer is checked against who the phone is now before it is
  // shown.
  const actorRef = useRef(actor);
  useEffect(() => {
    actorRef.current = actor;
  });
  // Read by the open effect after its await, where its own closure is stale.
  const collectedRef = useRef(collected);
  useEffect(() => {
    collectedRef.current = collected;
  }, [collected]);
  const revealedForRef = useRef(revealed);
  useEffect(() => {
    revealedForRef.current = revealed;
  }, [revealed]);
  // The two query keys the answer refreshes, read through refs so that neither
  // arriving mid-request re-runs the effect below — its cleanup cancels the
  // request in flight, and the latch would then refuse to send it again.
  const eventIdRef = useRef(event?.id);
  const participantIdRef = useRef(me?.participantId);
  useEffect(() => {
    eventIdRef.current = event?.id;
    participantIdRef.current = me?.participantId;
  });

  /**
   * Ask the server for today's pack.
   *
   * Fired on a tear and on a resume, once per request. Idempotent server-side:
   * the same league day answers the same three cards, so a retry after a lost
   * response, a second phone and a reload all land on one pack.
   */
  useEffect(() => {
    if (!openRequest || !actor || !identity) return;
    const key = `${actor}:${dayKey}:${openRequest.kind}:${openRequest.nonce}`;
    if (openFiredRef.current === key) return;
    openFiredRef.current = key;
    setOpenState("pending");
    const sentAs = actor;
    const sentOn = dayKey;
    const kind = openRequest.kind;
    // The pack this answer is for can be re-sealed before it lands: the day
    // tick and a deferred resume both reset everything, and a stale answer
    // applied on top put yesterday's cards back on a stand that had moved on.
    // Both halves are needed — the cleanup catches the request being replaced,
    // the day catches a reset that left the request alone.
    let cancelled = false;

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      // The row may still land server-side. That is fine: the retry re-reads
      // the day's pack rather than dealing a new one, so nothing is lost.
      setOpenState("failed");
    }, OPEN_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await open();
        settled = true;
        // The phone can have changed hands during the request, and this pack
        // belongs to the actor that asked for it — and to the day it was asked on.
        if (cancelled || actorRef.current !== sentAs || dealtOnRef.current !== sentOn) return;
        if (!res.ok) {
          setSlots([]);
          setOpenState("unavailable");
          return;
        }
        // A resumed row that does not describe this pack — a deal the phone
        // recorded that the server never kept, which should be impossible — is
        // progress over cards that are not on screen. Started over rather than
        // trusted.
        if (kind === "resume") {
          const stored = storedIdsRef.current;
          const answered = res.cards.map((c) => c.id);
          if (stored.length !== answered.length || stored.some((id, i) => id !== answered[i])) {
            revealedRef.current = [];
            setRevealed([]);
            setCursor(0);
            pendingCompletionsRef.current = [];
          }
        }
        // A guest's collection is the phone's. Snapshotted now, on the fresh
        // deal, and never from the live collection afterwards — the reveal
        // writes into it, and a snapshot taken then would count this pull.
        if (kind === "tear") {
          const before: Record<string, LocalBefore> = {};
          for (const slot of res.cards) {
            if (slot.kind === "roster" && slot.heldBefore == null) {
              const held = collectedRef.current[slot.id];
              before[slot.id] = { heldBefore: held?.count ?? 0, editionBefore: held?.edition ?? null }; // prettier-ignore
            }
          }
          setLocalBefore(before);
        }
        // The set(s) this pack finished, owed to the reveal of the card that
        // did it. On a resume the row says which are still owed; a row from
        // before the field existed owes every one not yet turned.
        const owed =
          kind === "tear"
            ? res.cards.flatMap((c, i) => (c.kind === "secret" && c.completedCollection ? [i] : []))
            : pendingCompletionsRef.current.length > 0
              ? pendingCompletionsRef.current
              : res.cards.flatMap(
                  (c, i) =>
                  c.kind === "secret" && c.completedCollection && !revealedForRef.current.includes(i) ? [i] : [], // prettier-ignore
                );
        pendingCompletionsRef.current = owed;
        setPendingCompletions(owed);
        if (kind === "tear") {
          // Claimed HERE rather than when the ceremony fires, because the fire
          // is a beat behind the card and the refetch below is not. Left until
          // then, the global host would see an uncelebrated trophy first and
          // play a second ceremony over the top of this one. A guest is marked
          // under the identity they actually have; `carryTrophySeen` translates
          // the key at claim time.
          const keys = res.cards.flatMap((c) =>
            c.kind === "secret" && c.completedCollection
              ? [trophyKey(participantIdRef.current ?? identity, c.completedCollection.collection)]
              : [],
          );
          if (keys.length > 0) markTrophiesCelebrated(keys);
        }
        setSlots(res.cards);
        setOpenState("idle");
        await Promise.all([
          qc.invalidateQueries({ queryKey: packStatusKey(sentAs) }),
          qc.invalidateQueries({ queryKey: mySecretsKey(sentAs) }),
          // The pack open is what advances the streak, for a guest as much as
          // for a member.
          qc.invalidateQueries({ queryKey: streakStatusKey(sentAs) }),
          qc.invalidateQueries({ queryKey: cardPullCountsKey(eventIdRef.current) }),
          qc.invalidateQueries({ queryKey: collectionTrophiesKey() }),
          // Only a member has card rows to recount; a guest's slots went nowhere.
          ...(participantIdRef.current
            ? [
                qc.invalidateQueries({
                  queryKey: myCardStatsKey(eventIdRef.current, participantIdRef.current),
                }),
              ]
            : []),
        ]);
      } catch (e) {
        settled = true;
        if (cancelled || actorRef.current !== sentAs) return;
        // The only place this app matches on an error string, justified because
        // the messages in require-auth.server.ts are explicitly contractual. A
        // token the server rejects is a token worth dropping, so the gate shows
        // instead of a retry that can never work.
        if (e instanceof Error && e.message.includes("Claim your player first")) {
          clearMemberToken();
        }
        setOpenState("failed");
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [openRequest, actor, identity, dayKey, open, qc]);

  // A phone changing hands mid-party is a real thing in this league. The resume
  // effect re-seals for the new person; this drops the request that was theirs.
  useEffect(() => {
    openFiredRef.current = null;
  }, [actor]);

  const streak = streakQuery.data ?? null;
  // Shared with the vault, which can now cash a rung from home — see
  // use-milestone-claim.ts for why the latches and the highest-rung-first rule
  // are what they are. This screen keeps the claim as well as home does: it is
  // where the streak was just extended.
  const {
    claimable,
    claiming,
    claimError,
    milestoneReveal,
    claim: claimMilestone,
    dismiss: dismissMilestone,
  } = useMilestoneClaim(actor, streak);

  /**
   * Every slot, resolved for the stand and the summary.
   *
   * This is the one place the pack's numbers are decided: the tier from the
   * bundle, the finish from the deal, the outcome from what was held before,
   * the count for the ribbon, and what a spare is worth — the last two gated
   * exactly as they always were: duplicates only, members only, silent while
   * the commissioner has dust switched off.
   */
  const standSlots = useMemo<StandSlot[]>(() => {
    const all = bundle?.participants ?? [];
    const pricing = !!me?.participantId && dustLive(event);
    return (slots ?? []).map((slot) => {
      if (slot.kind === "secret") {
        const outcome = slotOutcome(slot);
        // The secret's count lives on the server. `getMySecrets` is invalidated
        // by the deal itself, so it answers with this copy already counted —
        // and two is the floor while that refetch is still in the air, because
        // a duplicate is by definition never your first.
        const copies = !slot.duplicate
          ? 1
          : Math.max(2, mySecrets.data?.cards.find((c) => c.id === slot.id)?.count ?? 0);
        return {
          slot,
          rarity: secretFoil(slot.card.foil, slot.card.borderFx, slot.card.tier),
          edition: null,
          outcome,
          copies,
          sellValue: pricing && slot.duplicate ? secretSellValue(slot.card.tier) : null,
          ep: null,
        };
      }
      const local = localBefore[slot.id];
      const outcome = slotOutcome(slot, local);
      const copies = copiesAfter(slot, local);
      // `MILL_BY_EDITION` rather than `millValue`, and that is safe rather than
      // optimistic: the finish is the one Postgres minted. A finish it did not
      // decide is null, and null prices nothing — no number is better than a
      // number that moves.
      const sellValue =
        pricing && (copies ?? 1) > 1 && slot.edition != null
          ? MILL_BY_EDITION[toEdition(slot.edition)]
          : null;
      return {
        slot,
        rarity: rarities.get(slot.id) ?? rarityStyle("base"),
        edition: slot.edition,
        outcome,
        copies,
        sellValue,
        ep: all.find((p) => p.id === slot.id) ?? null,
      };
    });
  }, [slots, bundle, rarities, localBefore, mySecrets.data, me?.participantId, event]);

  async function revealAt(i: number) {
    // Both guards read refs, not state. A tap during a hold, and a second tap in
    // the same tick as the first, are the two ways this used to run twice over
    // one card — and neither is visible in `revealed` yet.
    if (revealingRef.current || revealedRef.current.includes(i)) return;
    const stand = standSlots[i];
    if (!stand) return;
    const { slot, rarity, outcome } = stand;
    const isSecret = slot.kind === "secret";

    revealingRef.current = true;
    try {
      // Hold on the glowing edge before a card worth waiting for lands. The
      // pause is the whole trick — and a duplicate secret you have seen three
      // times does not need the full production.
      const skipHold =
        isSecret &&
        outcome === "duplicate" &&
        (status.data?.secretsOwned ?? 0) > DUPE_CEREMONY_LIMIT;
      const hold = skipHold ? null : peekMs(slot, outcome);
      if (hold) {
        setPeeking(i);
        if (isSecret) {
          await new Promise((r) => setTimeout(r, SECRET_RISER_AT_MS));
          playSecretRiser(0.9);
          await new Promise((r) => setTimeout(r, hold - SECRET_RISER_AT_MS));
        } else {
          await new Promise((r) => setTimeout(r, hold));
        }
        setPeeking(null);
      }

      revealedRef.current = [...revealedRef.current, i];
      setRevealed(revealedRef.current);
      if (isSecret) {
        // Not a tier: a secret's rarity carries tier "base" so it satisfies the
        // type, and nothing may branch on that. The chime is named explicitly.
        // An upgrade gets the fresh chime: the level is the news.
        playReveal(outcome === "duplicate" ? SECRET_DUPE_CHIME : SECRET_CHIME);
      } else {
        playReveal(rarity.tier);
        // The finish's own cue is deliberately not fired here. It belongs to the
        // beat *after* the card lands, and PackStand fires it on the frame the
        // metal comes up.
        const edition = slot.edition ?? "standard";
        void collectCard(slot.id, rarity.tier, edition);
        // Optimistic, and held apart from the reconciled collection: a card the
        // server has not vouched for is exactly what the merge would prune, so
        // without this a guest's card would light up as they flipped it and then
        // vanish. Counted from the snapshot the pack was dealt against.
        const before = slot.heldBefore ?? localBefore[slot.id]?.heldBefore ?? 0;
        mine.markCollected(slot.id, rarity.tier, edition, before + 1);
        // A carried pack's card the claim's adoption never saw. The server
        // minted nothing for a guest, and this is the only thing that will ever
        // file it — protected by the unrecorded row until it lands, because the
        // merge deletes anything the server cannot vouch for.
        if (
          carriedFromRef.current &&
          me?.participantId &&
          !carriedAdoptedRef.current.includes(slot.id)
        ) {
          carriedAdoptedRef.current = [...carriedAdoptedRef.current, slot.id];
          void (async () => {
            await addUnrecorded({ dayKey, identity: identity ?? undefined, ids: [slot.id] });
            try {
              await adopt({ data: { eventParticipantIds: [slot.id] } });
              await qc.invalidateQueries({ queryKey: myCardStatsKey(event?.id, me.participantId) }); // prettier-ignore
              await retireUnrecorded([slot.id]);
            } catch {
              /* the row keeps protecting it; the next claim adopts it */
            }
          })();
        }
      }

      // Which burst, if any: the tier's own for a champion or a good finish, the
      // framed shot for a new secret, the lift for a rung climbed.
      const burst = celebrationFor({ slot, outcome, tier: rarity.tier });
      if (burst === "tier") {
        await celebrate(rarity, slot.kind === "roster" ? (slot.edition ?? "standard") : "standard");
      } else if (burst === "secret") {
        await celebrateSecret(rarity);
      } else if (burst === "upgrade") {
        const rung = upgradeLabel(slot);
        const accent =
          rung?.accent ??
          (isSecret ? secretTierStyle(slot.card.tier).accent : editionStyle("standard").accent);
        await celebrateUpgrade(accent);
      }

      // And only now, once the card has been seen and its own burst has run:
      // "that was the last one". Two celebrations on top of each other is one
      // celebration nobody can read.
      if (isSecret && slot.completedCollection && pendingCompletionsRef.current.includes(i)) {
        const rest = pendingCompletionsRef.current.filter((n) => n !== i);
        pendingCompletionsRef.current = rest;
        await new Promise((r) => setTimeout(r, COMPLETION_BEAT_MS));
        setCompletion(slot.completedCollection);
        // And only once it has actually fired does the row let go of it. Cleared
        // with the ref instead, a reload during the beat above would lose the
        // ceremony exactly as it used to.
        setPendingCompletions(rest);
      }
    } finally {
      revealingRef.current = false;
      releaseDeferredResume();
    }
  }

  // Written on every step rather than only on tear, so a phone that loses the tab
  // mid-reveal comes back to the cards it had already flipped.
  useEffect(() => {
    if (!slots || slots.length === 0 || !stateLoaded) return;
    // Never write this pack under an identity it was not dealt to. `identity`
    // moves a whole render before the resume load can answer — a claim in another
    // tab is the case — and `stateLoaded` is still true on that render, because
    // the resume effect's `setStateLoaded(false)` lands with the next one.
    //
    // The day is the same argument. `dayKey` moves on the tick a render before
    // the load can answer, and writing then rewrites the row to claim yesterday's
    // cards are today's pack — which the next resume believes.
    if (dealtForRef.current !== identity || dealtOnRef.current !== dayKey) return;
    void savePackState({
      dayKey,
      // The roster ids alone, in lockstep with `cards`: `carriedAdopted` and the
      // unrecorded row name roster ids, and the e2e suite reads this field.
      ids: slots.filter((s) => s.kind === "roster").map((s) => s.id),
      cards: slots.map((s) => slotRef(s, localBefore[s.id])),
      revealed,
      identity: identity ?? undefined,
      cursor,
      // Both survive the reload for the same reason the reveal progress does:
      // whoever loads this row next has to know the pack was carried, and that a
      // ceremony is still owed.
      carriedFrom: carriedFromRef.current ?? undefined,
      carriedAdopted: carriedFromRef.current ? [...carriedAdoptedRef.current] : undefined,
      pendingCompletions: pendingCompletions.length > 0 ? pendingCompletions : undefined,
    });
  }, [slots, dayKey, revealed, stateLoaded, identity, cursor, pendingCompletions, localBefore]);

  const stage = packStage({
    torn,
    opening,
    packSize: slots?.length ?? PACK_SIZE,
    cursor,
  });

  // Insurance. `entering` is normally cleared by the stand landing, but a stand
  // that never mounts — a deal that failed, or the day tick re-sealing underneath
  // — would otherwise leave a deck of card backs pinned over a screen that has
  // moved on.
  useEffect(() => {
    if (stage !== "revealing" && entering) setEntering(null);
  }, [stage, entering]);

  /**
   * Turn every card, in order, without waiting for a tap between them.
   *
   * Kept sequential: the chimes are tuned to land one after another, and firing
   * them together stacks into noise.
   */
  async function revealEverything() {
    // Two taps used to start two sequences over the same cards, each collecting
    // and celebrating them again.
    if (autoRef.current || !slots) return;
    autoRef.current = true;
    setAutoRunning(true);
    try {
      for (let i = cursor; i < slots.length; i++) {
        setCursor(i);
        // Let the card arrive face-down and paint before it turns. Without this
        // the cursor move and the reveal batch into one render, so the stand
        // mounts the next card already face-up and the flip — the thing being
        // animated — is skipped for every card the sequence advances to.
        await new Promise((r) => setTimeout(r, AUTO_MOUNT_MS));
        await revealAt(i);
        await new Promise((r) => setTimeout(r, AUTO_STEP_MS));
      }
      setCursor(slots.length);
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
    if (stage !== "revealing" && stage !== "opening") return;
    for (const s of [slots?.[cursor], slots?.[cursor + 1]]) {
      if (!s) continue;
      void preloadCard(s.kind === "secret" ? s.card.artUrl : (cards.data?.[s.id]?.front ?? null));
    }
  }, [stage, cursor, slots, cards.data]);

  const collectedCount = mine.collectedCount;
  const total = bundle?.participants.length ?? 0;

  // Nothing on this screen survives a league nobody can reach: no roster means
  // no cards to draw. Said out loud here rather than above the wrapper, because
  // on the commonest version of this — a pack already torn today — the row comes
  // back from IndexedDB while the roster is still empty, and the guard below
  // would sit on "Loading…" for good. The same shape /leaderboard and /analytics
  // use for a read they cannot make.
  if (eventFailed) {
    return (
      <div className="card-bg min-h-[var(--page-min-h)]">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <FeedError
            message="Your cards are safe on this phone — today's pack needs the roster before it can be dealt."
            onRetry={() => void refetch()}
          />
        </div>
      </div>
    );
  }

  // The sealed pack must not flash on a day already opened, so nothing renders
  // until the stored state has been read.
  if (!stateLoaded) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  // The scene owns the device from the moment the rip commits until the pack is
  // finished. Released on `complete`, which is a page again — a collection
  // summary with links out of it wants its navigation back.
  const presenting = stage === "opening" || stage === "revealing";
  // What "presentation mode is active" actually means on this route: the pack's
  // own ceremony, plus the milestone reveal, which claims the screen the same way
  // from a different trigger. Three things key off it and they must not drift.
  const presentingAny = presenting || milestoneReveal !== null;

  /** The wrapper is off and the cards are not here yet, or never will be. */
  const dealing = torn && !opening && (slots == null || slots.length === 0);

  return (
    <div className="card-bg min-h-[var(--page-min-h)]">
      {/* The same banner five other screens show. Silent while the ceremony has
          the screen: a warning strip over the one moment this app is asking for
          your attention is noise, and the pack is not where anybody can act on
          it. It comes back the instant the summary lands. */}
      {!presentingAny && (realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}
      <PresentationMode active={presentingAny} />
      <PresentationStage active={presentingAny} />
      {/* Mounted here rather than inside the summary: the stage above uses
          backdrop-filter, which is a grouping property, so anything it wraps
          loses its 3D and the card would flip flat. */}
      {completion && (
        <CollectionComplete
          label={completion.label}
          size={completion.size}
          onDone={() => setCompletion(null)}
        />
      )}
      {milestoneReveal && (
        <MilestoneReveal
          milestone={milestoneReveal.milestone}
          streak={milestoneReveal.streak}
          card={milestoneReveal.card}
          tierFloor={milestoneReveal.tierFloor}
          duplicate={milestoneReveal.duplicate}
          universalBack={urlFromSet(packBack.data?.urls) ? (packBack.data?.urls ?? null) : null}
          onDone={dismissMilestone}
        />
      )}
      {/* The one control that has to survive the whole pack.

          Fixed and outside the content wrapper on purpose: it is above the
          presentation stage's z-0 scrim, and it is in none of the three motion
          wrappers that fade for the tear, so it is reachable on the sealed
          screen, mid-reveal and on the summary alike — the same corner every
          time. Lifted to clear the mobile tab bar, which is fixed at the bottom
          and only exists below md. */}
      <SoundToggle className="fixed bottom-[calc(var(--tab-bar-h)+0.25rem)] left-1 z-40 rounded-full border border-white/10 bg-background/70 backdrop-blur-sm md:bottom-4" />
      <div className="relative z-10 mx-auto max-w-4xl px-4 py-3 sm:py-6">
        {/* Same gate as the vault, and here for the same reason: a pack opened
            before they pick a name lands on the device, not on them. Kept out of
            the ceremony itself — only while the pack is still sealed. */}
        {stage === "sealed" && <CollectorSignupGate className="mb-3" />}
        {/* Only while the pack is still sealed. A phone screen is short, and this
            row is 90px of running total above a card whose whole job is to be the
            biggest thing on it. The summary owns the counter once the pack is
            done, and owns the way back to the vault with it. */}
        {(stage === "sealed" || stage === "opening") && (
          // For the opening it fades out and goes inert rather than unmounting.
          //
          // Gone from the screen and gone from the tab order, which is the part
          // that was a bug — a Vault link dimmed to 20% under a backdrop is still
          // a link somebody can reach. What it deliberately does *not* do is give
          // its 90px back: taking those out of the flow at the moment the rip
          // commits slides the pack, the strip and the cards in it upward on the
          // one frame the tear is meant to be the only thing moving.
          <motion.div
            inert={stage === "opening"}
            animate={{ opacity: stage === "opening" ? 0 : 1 }}
            transition={{ duration: 0.3 }}
            className="mb-3 flex items-center justify-between border-b border-primary/20 pb-2"
          >
            <div className="flex items-center gap-3">
              <Link
                to="/players"
                className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-label font-bold uppercase tracking-[0.08em] text-primary hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Vault
              </Link>
            </div>
            {/* Height-matched to the Collected block beside it, so the row still
                gives back none of its 90px when it fades for the tear. */}
            {streak && <StreakFlame streak={streak} />}
            <div className="text-right">
              <div className="font-display text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Collected
              </div>
              {/* Dashed until reconciled. Also the one place on this screen that
                  says out loud whether the collection has landed, which is part
                  of what decides whether a rip will take at all — `tearOpen`
                  refuses while it is still out. The e2e suite waits on the dash
                  clearing for exactly that reason, hence the test id. */}
              <div
                data-testid="collected-count"
                className="font-display text-lg font-black text-primary"
              >
                {mine.ready ? `${collectedCount} / ${total}` : `— / ${total}`}
              </div>
            </div>
          </motion.div>
        )}

        {stage === "sealed" || stage === "opening" ? (
          <div className="flex flex-col items-center gap-3 py-2 sm:gap-5 sm:py-4">
            {/* Faded rather than unmounted. Removing the copy at the moment the
                rip commits reflows the pack upward on the exact frame the tear is
                meant to be the only thing moving. */}
            <motion.div
              className="text-center"
              animate={{ opacity: stage === "opening" ? 0.12 : 1 }}
              transition={{ duration: 0.3 }}
            >
              <h1 className="font-display text-2xl font-black uppercase leading-none sm:text-3xl">
                Today&apos;s Pack
              </h1>
              <p className="mt-1 max-w-xs px-2 text-meta leading-snug text-muted-foreground sm:mt-2 sm:max-w-sm">
                One pack a day, dealt to you and nobody else.
              </p>
              {streak && streakLine(streak) && (
                <p
                  className="mt-1 text-xs font-bold sm:mt-2"
                  style={{ color: "oklch(0.82 0.19 85)" }}
                >
                  {streakLine(streak)}
                </p>
              )}
            </motion.div>

            <PackOpening
              // Only the jitter is seeded off this — which way each card leans as
              // it leaves the pack. Nothing about which cards they are.
              seed={`${dayKey}:${identity ?? ""}`}
              artUrl={packBack.data?.urls ?? null}
              packSize={PACK_SIZE}
              year={String(event?.year ?? "")}
              // Three, always: the server deals exactly that many, and every one
              // shows the same back. Which of them is a secret is the stand's
              // news to break.
              slots={PACK_SIZE}
              onTear={tearOpen}
              onDone={closeCeremony}
            />

            <motion.div
              className="text-label font-bold uppercase tracking-[0.08em] text-muted-foreground"
              animate={{ opacity: stage === "opening" ? 0 : 1 }}
              transition={{ duration: 0.2 }}
            >
              Drag across the tear · or press Enter
            </motion.div>
          </div>
        ) : dealing ? (
          // The wrapper is off and the cards are still on their way — or the
          // server could not deal any. Never a toast: a toast announces the
          // pack to whoever is glancing at the phone over your shoulder.
          <div className="mx-auto flex max-w-[320px] flex-col items-center gap-3 py-6 text-center">
            {openState === "failed" ? (
              <button
                onClick={() => {
                  setOpenState("pending");
                  setOpenRequest((r) => ({ kind: r?.kind ?? "tear", nonce: (r?.nonce ?? 0) + 1 }));
                }}
                data-testid="pack-retry"
                className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center opacity-60"
              >
                <span className="font-display text-badge font-black uppercase tracking-[0.08em]">
                  No signal
                </span>
                <span className="text-meta leading-snug text-muted-foreground">
                  Tap to try again — today&apos;s pack is still yours.
                </span>
              </button>
            ) : openState === "unavailable" ? (
              <>
                <div className="wax-foil flex aspect-[5/7] w-full items-center justify-center rounded-xl border border-white/15 opacity-60">
                  <span className="font-display text-badge font-black uppercase tracking-[0.08em]">
                    Nothing to deal today
                  </span>
                </div>
                <Link to="/players" className="neon-btn-lg neon-btn-hero w-full">
                  <PackageOpen className="h-4 w-4" />
                  View collection
                </Link>
              </>
            ) : (
              // The same sealed-back sweep the old fourth slot showed while its
              // pull was in the air.
              <div
                data-testid="pack-dealing"
                className="wax-foil pack-seal-wait relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-xl border border-white/15"
              />
            )}
          </div>
        ) : stage === "revealing" ? (
          // No heading. The card is the interface — a title over it is a web page
          // telling you what the thing below it is for, and with the shell gone
          // the only thing on screen should be the card.
          <div className="space-y-3">
            <PackStand
              slots={standSlots}
              bundle={bundle}
              cursor={cursor}
              cards={cards.data}
              revealed={revealed}
              universalBack={urlFromSet(packBack.data?.urls) ? (packBack.data?.urls ?? null) : null}
              pullCounts={pullCounts.data}
              peeking={peeking === cursor}
              busy={autoRunning}
              fromPack={ceremonyRanRef.current}
              enteringFrom={entering}
              onEntered={() => setEntering(null)}
              onReveal={(i) => void revealAt(i)}
              onAdvance={() => setCursor((c) => c + 1)}
            />

            <div className="flex justify-center pt-2">
              {/* Kept, and kept findable by name — the e2e suite drives the
                  whole sequence through it — but demoted to a ghost. An escape
                  hatch competing with the card for attention is an invitation
                  to skip the thing you came for. */}
              <button
                onClick={() => void revealEverything()}
                // Also off while the deck is still landing: for those few
                // hundred milliseconds the real card is invisible behind the
                // flight, and this would turn a card nobody can see.
                disabled={autoRunning || entering != null}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground/70 hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground/70"
              >
                Reveal all
              </button>
            </div>
          </div>
        ) : (
          <PackSummary
            slots={standSlots}
            bundle={bundle}
            cards={cards.data}
            revealed={revealed}
            pullCounts={pullCounts.data}
            universalBack={urlFromSet(packBack.data?.urls) ? (packBack.data?.urls ?? null) : null}
            collected={collectedCount}
            total={total}
            eventYear={event?.year ?? null}
            streak={streak}
            claimable={claimable}
            canClaim={streak?.canClaim ?? false}
            claiming={claiming}
            claimError={claimError}
            onClaim={() => {
              if (claimable) void claimMilestone(claimable.days);
            }}
          />
        )}
      </div>
    </div>
  );
}
