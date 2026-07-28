import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { mySecretsKey, secretStatusKey, useSecretStatus } from "@/hooks/use-daily-secret";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { PackWrapper } from "@/components/pack-wrapper";
import { PackBoard, type BoardCard } from "@/components/pack-board";
import { PackSecretSlot, type SecretSlot } from "@/components/pack-secret-slot";
import { PackStage, type StagePhase, type StageCard } from "@/components/pack-stage";
import { rarityMap, rarityStyle, type Rarity } from "@/lib/card-rarity";
import { collectCard, loadCollection, loadPackState, savePackState } from "@/lib/card-collection";
import { playReveal, playSecretRiser, playSecretReveal, playTear } from "@/lib/card-sfx";
import { celebrate, celebrateSecret } from "@/lib/card-confetti";
import { pullSecretCard } from "@/lib/secret-cards.functions";
import { secretFoil, type SecretCardView } from "@/lib/secret-cards";
import { clearMemberToken, useMemberSession } from "@/lib/member-token";
import { usePackIdentity } from "@/lib/device-id";
import { dealPack, packSeed } from "@/lib/pack";
import { recordCardPulls } from "@/lib/card-pulls.functions";
import { cardPullCountsKey, useCardPullCounts } from "@/hooks/use-card-pulls";
import { packedByLabel } from "@/lib/card-pulls";

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

/**
 * The fourth slot's index on the stage.
 *
 * A sentinel rather than `pack.length`, because `pack` is empty for a beat while
 * the bundle loads and a length-derived sentinel would quietly point at card 0.
 */
const SECRET_STAGE_INDEX = -1;

/** Hold on the glowing edge before the hit comes up. The pause is the whole trick. */
const PEEK_MS = 900;
/** The once-a-day card holds longer. It is the only card here nobody has seen. */
const SECRET_PEEK_MS = 1600;
/** Where in that hold the riser starts, so it lands on the chime's bottom note. */
const SECRET_RISER_AT_MS = 700;
/** How long a flipped card stays up before it flies down to the board. */
const HOLD_MS = 1400;
/** A card worth confetti stays up long enough for the confetti to finish. */
const CELEBRATION_HOLD_MS = 2200;
/**
 * Every hold, once "Reveal all" is pressed. "Reveal all" means stop performing at
 * me, so the ceremony collapses to a flick-through rather than replaying itself
 * at full length — and the whole run has to fit inside the e2e suite's patience.
 */
const AUTO_HOLD_MS = 420;
/**
 * Backstop on a flight that never reports finishing.
 *
 * onAnimationComplete is the normal path, but a card that never advances leaves
 * the ceremony wedged with no way out but a reload, on the one screen where that
 * costs a person their pack for the day. Cheap insurance.
 */
const FLIGHT_TIMEOUT_MS = 1200;
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

/** Local date key so the pack rolls over at midnight in the user's own timezone. */
function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Which card is up, and where it is in its own little life.
 *
 * Not persisted, and that is the design rather than an omission. A ceremony is a
 * live performance: resuming "card two was mid-flip when the tab died" would
 * replay half an animation with no gesture behind it. What survives a reload is
 * what *landed*, which is exactly what PackState already stores — so this needs
 * no new field, and the e2e suite can keep opening the database at version 2.
 */
type Stage = { index: number; phase: StagePhase } | null;

function PackPage() {
  const { event, bundle } = useEventBundle();
  const cards = useEventCardUrls(event?.id ?? null);
  // The event's back, never a player's — see the note on useEventCardBack. The
  // wrapper is shown before anything has been dealt, so a per-player back here
  // would be the reveal, printed on the outside of the pack.
  const packBack = useEventCardBack(event?.id ?? null);
  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  const [collected, setCollected] = useState<Record<string, unknown>>({});
  const [collectionLoaded, setCollectionLoaded] = useState(false);
  // Snapshot of the collection taken when a pack is dealt. The pack composition
  // must not shift while the user is revealing it, and revealing a card writes
  // straight back into `collected`.
  const [packBaseline, setPackBaseline] = useState<Record<string, unknown> | null>(null);
  // Today's dealt cards, once the wrapper is off. Null means the pack is still
  // sealed; undefined-until-loaded is tracked by `stateLoaded` instead, so the
  // sealed pack never flashes on a day that has already been opened.
  const [dealtIds, setDealtIds] = useState<string[] | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  // "Landed on the board face-up". A card up on the stage is simply not in here
  // yet, which is what makes a mid-ceremony reload resume honestly.
  const [revealed, setRevealed] = useState<number[]>([]);

  // ---- the ceremony ----
  const [stage, setStage] = useState<Stage>(null);
  const [stageFlipped, setStageFlipped] = useState(false);
  /** Set by "Reveal all": every hold collapses to AUTO_HOLD_MS from then on. */
  const [auto, setAuto] = useState(false);
  /** Board slots, for the flight. Never state — nothing should re-render on it. */
  const slotsRef = useRef(new Map<number, HTMLElement>());
  /** The wrapper's rect, captured the instant before it was torn away. */
  const wrapperRectRef = useRef<DOMRect | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- the fourth slot ----
  const me = useMemberSession();
  const qc = useQueryClient();
  const pull = useServerFn(pullSecretCard);
  const record = useServerFn(recordCardPulls);
  const pullCounts = useCardPullCounts(event?.id ?? null);
  const status = useSecretStatus(me?.participantId);
  const [secret, setSecret] = useState<SecretCardView | null>(null);
  const [secretDuplicate, setSecretDuplicate] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretPulling, setSecretPulling] = useState(false);
  const [secretFailed, setSecretFailed] = useState(false);
  const [secretUnavailable, setSecretUnavailable] = useState(false);
  // Set synchronously before the request goes out. setDealtIds is async, so two
  // Enter presses in one tick both see the old state; this also survives
  // StrictMode mounting every effect twice in development.
  const pullFiredRef = useRef(false);
  const revealingRef = useRef(false);

  // The *pack* day is device-local: a pack has no identity and no constraint
  // behind it. The *drop* day is league-owned, decided in Postgres. Two clocks,
  // deliberately — see the server-day effect below.
  const [dayKey, setDayKey] = useState(todayKey);
  // Null until the browser has answered. Nothing is dealt against a half-known
  // identity, or a claimed member would flash a device-seeded pack first.
  const identity = usePackIdentity();
  const seed = identity ? packSeed(event?.id ?? null, dayKey, identity) : null;

  useEffect(() => {
    loadCollection().then((c) => {
      setCollected(c);
      setCollectionLoaded(true);
    });
  }, []);

  // One pack a day, so a return visit resumes rather than deals. Yesterday's row
  // is simply ignored — the next tear overwrites it.
  useEffect(() => {
    let cancelled = false;
    // Cleared first so the rollover below cannot write today's key over
    // yesterday's ids in the window before this resolves.
    setStateLoaded(false);
    loadPackState().then((s) => {
      if (cancelled) return;
      // A missing identity is treated as a match, so nobody mid-reveal on the
      // day this ships loses their cards to the new field.
      const mine = s?.identity == null || s.identity === identity;
      if (s && s.dayKey === dayKey && mine && s.ids.length > 0) {
        setDealtIds(s.ids);
        setRevealed(s.revealed);
        setSecretRevealed(!!s.secretRevealed);
      } else {
        setDealtIds(null);
        setRevealed([]);
        setSecretRevealed(false);
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
      // a far worse bug than the stale tab this is fixing.
      if (revealingRef.current) return;
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

  useEffect(() => {
    if (!collectionLoaded) return;
    setPackBaseline((prev) => prev ?? collected);
  }, [collectionLoaded, collected]);

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
  const secretRarity = secretFoil(secret?.foil);

  const secretSlot: SecretSlot = !torn
    ? "hidden"
    : !me
      ? "gated"
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

  // The whole ceremony counts as "under somebody's thumb", not just the moment
  // inside an await — a card up on the stage must not be re-sealed at midnight.
  useEffect(() => {
    revealingRef.current = stage != null;
  }, [stage]);

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (flightTimerRef.current) clearTimeout(flightTimerRef.current);
    holdTimerRef.current = null;
    flightTimerRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /**
   * What comes up next, or null when the board is finished.
   *
   * The secret goes last on purpose: its hold is nearly twice a hit's, and
   * landing underneath one means neither of them reads.
   */
  const nextStage = useCallback(
    (landed: number[]): Stage => {
      const i = pack.findIndex((_, n) => !landed.includes(n));
      if (i >= 0) return { index: i, phase: "entering" };
      // Only when it is pulled and unrevealed. A pending pull is not worth
      // holding an empty stage open for — see the timeout's comment.
      if (secret && !secretRevealed) return { index: SECRET_STAGE_INDEX, phase: "entering" };
      return null;
    },
    [pack, secret, secretRevealed],
  );

  const openStage = useCallback(
    (index: number) => {
      clearTimers();
      setStageFlipped(false);
      setStage({ index, phase: "entering" });
    },
    [clearTimers],
  );

  /**
   * A swipe that finished before the roster did.
   *
   * The gesture used to be swallowed whole: the pack sat there, apparently
   * ignoring a completed tear, and the only recovery was to swipe again. On a
   * phone in a garden that reads as broken rather than as slow. Latching the
   * intent means the pack opens the instant it *can*, which is what the person
   * asked for either way.
   */
  const pendingTearRef = useRef(false);

  const tearOpen = useCallback(
    (rect: DOMRect | null) => {
      if (dealtIds) return;
      wrapperRectRef.current = rect;
      if (nextPack.length === 0) {
        pendingTearRef.current = true;
        return;
      }
      setDealtIds(nextPack.map((p) => p.id));
      playTear();
      // Straight onto the stage: the tear and the first card are one gesture's
      // worth of payoff, not two.
      setStageFlipped(false);
      setStage({ index: 0, phase: "entering" });
    },
    [dealtIds, nextPack],
  );

  useEffect(() => {
    if (!pendingTearRef.current || dealtIds || nextPack.length === 0) return;
    pendingTearRef.current = false;
    tearOpen(wrapperRectRef.current);
  }, [dealtIds, nextPack, tearOpen]);

  const isSecretStage = stage?.index === SECRET_STAGE_INDEX;

  /** The anticipation hold, once a card has finished flying in. */
  const holdBeforeFlip = useCallback(
    (index: number) => {
      if (auto) return 0;
      if (index === SECRET_STAGE_INDEX) {
        // A duplicate you have seen three times does not need the full
        // production. The card still comes up; it just stops pausing first.
        const ceremony = !secretDuplicate || (status.data?.pulled ?? 0) <= DUPE_CEREMONY_LIMIT;
        return ceremony ? SECRET_PEEK_MS : 0;
      }
      // The last of the three is the hit. Everything before it comes straight up.
      return index === pack.length - 1 ? PEEK_MS : 0;
    },
    [auto, pack.length, secretDuplicate, status.data?.pulled],
  );

  /**
   * A card has finished flying onto the stage.
   *
   * Reads `stage` from the closure rather than from a setStage updater. The
   * scheduling below is a side effect, and a state updater is called twice under
   * StrictMode — which would have meant two risers over each other and two
   * timers racing to advance the same card.
   *
   * Re-entrant on purpose: both onAnimationComplete and the backstop timer can
   * land here. Clearing first means a second call reschedules rather than
   * stacking.
   */
  const handleEntered = useCallback(() => {
    const s = stage;
    if (!s || s.phase !== "entering") return;
    clearTimers();

    const hold = holdBeforeFlip(s.index);
    if (hold === 0) {
      setStage({ ...s, phase: "facedown" });
      return;
    }
    if (s.index === SECRET_STAGE_INDEX) {
      // Timed to land on the chime's bottom note rather than run under it.
      holdTimerRef.current = setTimeout(() => playSecretRiser(0.9), SECRET_RISER_AT_MS);
    }
    flightTimerRef.current = setTimeout(
      () => setStage((cur) => (cur?.phase === "entering" ? { ...cur, phase: "facedown" } : cur)),
      hold,
    );
  }, [stage, holdBeforeFlip, clearTimers]);

  /** The card turned over. This is the reveal: chime, collection, confetti. */
  const handleFlip = useCallback(
    (next: boolean) => {
      setStageFlipped(next);
      const s = stage;
      if (!s || s.phase !== "facedown" || !next) {
        // A second tap on a card already face-up just turns it back to its stats,
        // and cancels the auto fly-down so it can actually be read.
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        return;
      }

      if (s.index === SECRET_STAGE_INDEX) {
        setStage({ ...s, phase: "held" });
        // Marked seen *here*, on the flip, rather than when it lands. The three
        // roster cards can afford "landed on the board" semantics — flipping one
        // again after a badly timed reload costs nothing. The once-a-day card
        // cannot: it is spent server-side the moment it is pulled, so a reload
        // during the hold that put it back face-down would be the app asking
        // someone to open the same drop twice.
        setSecretRevealed(true);
        playSecretReveal(secretDuplicate);
        // A duplicate gets the shimmer, never a second burst — a wink, not a parade.
        if (!secretDuplicate) void celebrateSecret(secretRarity);
        return;
      }

      const ep = pack[s.index];
      if (!ep) return;
      const rarity = rarities.get(ep.id) ?? rarityStyle("base");
      setStage({ ...s, phase: "held" });
      playReveal(rarity.tier);
      void collectCard(ep.id, rarity.tier);
      setCollected((prev) => ({ ...prev, [ep.id]: true }));
      if (rarity.tier === "champion" || rarity.tier === "podium") void celebrate(rarity);
    },
    [stage, pack, rarities, secretDuplicate, secretRarity],
  );

  const sendToBoard = useCallback(() => {
    setStage((prev) => (prev?.phase === "held" ? { ...prev, phase: "landing" } : prev));
  }, []);

  /** The card reached its slot. Commit it and bring up the next one. */
  const handleLanded = useCallback(() => {
    const s = stage;
    if (!s || s.phase !== "landing") return;
    clearTimers();

    // Already marked seen on the flip — this only closes the stage.
    if (s.index === SECRET_STAGE_INDEX) {
      setStage(null);
      return;
    }
    // Both in one handler so React batches them: the flying card unmounts and its
    // slot fills in a single commit, with no frame where the card is nowhere.
    const landed = [...revealed, s.index];
    setRevealed(landed);
    const next = nextStage(landed);
    setStageFlipped(false);
    setStage(next);
  }, [stage, revealed, nextStage, clearTimers]);

  // Once face-up, a card flies down on its own — "then they animate down to the
  // board" is the whole shape of this screen. Cancelled if the card is turned
  // over to read its stats, and collapsed to a flick under "Reveal all".
  useEffect(() => {
    if (stage?.phase !== "held" || !stageFlipped) return;
    const ep = stage.index === SECRET_STAGE_INDEX ? null : pack[stage.index];
    const tier = ep ? (rarities.get(ep.id)?.tier ?? "base") : null;
    const celebrating =
      stage.index === SECRET_STAGE_INDEX
        ? !secretDuplicate
        : tier === "champion" || tier === "podium";
    const wait = auto ? AUTO_HOLD_MS : celebrating ? CELEBRATION_HOLD_MS : HOLD_MS;
    holdTimerRef.current = setTimeout(sendToBoard, wait);
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [stage, stageFlipped, auto, pack, rarities, secretDuplicate, sendToBoard]);

  // "Reveal all" turns the flip itself into a step the ceremony takes for you.
  useEffect(() => {
    if (!auto || stage?.phase !== "facedown") return;
    const t = setTimeout(() => handleFlip(true), AUTO_HOLD_MS);
    return () => clearTimeout(t);
  }, [auto, stage, handleFlip]);

  // Backstop for a flight that never reports finishing. A wedged stage is
  // unrecoverable without a reload, and a reload here costs a person their pack.
  useEffect(() => {
    if (stage?.phase !== "entering" && stage?.phase !== "landing") return;
    const phase = stage.phase;
    const t = setTimeout(
      () => (phase === "landing" ? handleLanded() : handleEntered()),
      FLIGHT_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [stage, handleEntered, handleLanded]);

  // The secret is the finale, so it comes up once the three have landed — even
  // if it only arrived from the server after the stage had already closed.
  useEffect(() => {
    if (!torn || stage || !secret || secretRevealed) return;
    if (pack.length === 0 || revealed.length < pack.length) return;
    openStage(SECRET_STAGE_INDEX);
  }, [torn, stage, secret, secretRevealed, pack.length, revealed.length, openStage]);

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
    if (!torn || !me?.participantId || pullFiredRef.current) return;
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
          qc.invalidateQueries({ queryKey: secretStatusKey(me.participantId) });
          qc.invalidateQueries({ queryKey: mySecretsKey(me.participantId) });
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
  }, [torn, me?.participantId, pull, qc]);

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
      // The first authenticated tear also carries whatever this device already
      // had, so cards somebody owns count from day one rather than reading
      // "packed by nobody" for a fortnight. The composite primary key caps a
      // person at one row per card, so an inflated list can do nothing.
      const collectedIds = Object.keys(await loadCollection());
      const ids = [...new Set([...dealtIds, ...collectedIds])].slice(0, 64);
      try {
        await record({ data: { eventParticipantIds: ids } });
        await qc.invalidateQueries({ queryKey: cardPullCountsKey(event?.id) });
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
  }, [me?.participantId]);

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
    });
  }, [dealtIds, dayKey, revealed, secretRevealed, stateLoaded, identity]);

  const registerSlot = useCallback((index: number, el: HTMLElement | null) => {
    if (el) slotsRef.current.set(index, el);
    else slotsRef.current.delete(index);
  }, []);

  const boardCards: BoardCard[] = pack.map((ep) => {
    const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
    return {
      id: ep.id,
      name: ep.participant?.name ?? "—",
      rarity,
      frontUrl: cards.data?.[ep.id]?.front ?? null,
      backUrl: cards.data?.[ep.id]?.back ?? null,
      backContent: <CardBackPanel ep={ep} bundle={bundle} rarity={rarity} />,
      packedBy: packedByLabel(pullCounts.data?.[ep.id]) || null,
    };
  });

  const allPlayerCardsRevealed = pack.length > 0 && revealed.length === pack.length;
  // A slot still working counts as outstanding, or "Pack Complete" flashes for a
  // beat before the fourth card turns up. For a guest, or a pull that failed,
  // this reduces to exactly the old expression.
  const allRevealed =
    allPlayerCardsRevealed && stage == null && secretSlot !== "pending" && secretSlot !== "sealed";
  const collectedCount = (bundle?.participants ?? []).filter((p) => collected[p.id]).length;
  const total = bundle?.participants.length ?? 0;
  // Everyone who gets a fourth card sees four pips; nobody else is told there is
  // one to miss.
  const stageTotal = pack.length + (secret ? 1 : 0);

  const stageCard: StageCard | null = (() => {
    if (!stage) return null;
    const faceUp = stageFlipped;

    if (stage.index === SECRET_STAGE_INDEX) {
      if (!secret) return null;
      return {
        cacheKey: secret.id,
        name: faceUp ? secret.name : "Secret card",
        // The secret's tier is loud — a rosette foil and a spinning rainbow
        // bezel — so it stays base until it is face-up, same as the others.
        rarity: faceUp ? secretRarity : rarityStyle("base"),
        frontUrl: faceUp ? secret.artUrl : null,
        backUrl: faceUp ? secret.backUrl : (packBack.data?.url ?? null),
        backContent: faceUp ? (
          <SecretBackPanel card={secret} rarity={secretRarity} />
        ) : (
          <SealedFace />
        ),
        caption: faceUp ? (
          <SecretCaption
            name={secret.name}
            duplicate={secretDuplicate}
            rarity={secretRarity}
            pulledCount={status.data?.pulled ?? 0}
          />
        ) : (
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
            Something else…
          </p>
        ),
      };
    }

    const ep = pack[stage.index];
    if (!ep) return null;
    const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
    const name = ep.participant?.name ?? "—";
    return {
      cacheKey: ep.id,
      // The real name only once it is face-up. A face-down card announcing whose
      // it is would be the spoiler this whole screen exists to withhold.
      name: faceUp ? name : `Card ${stage.index + 1}`,
      // And the real tier only once it is face-up, for the same reason: HoloCard
      // paints the tier onto the border and the outer glow, so a gold card would
      // announce itself through the back of it.
      rarity: faceUp ? rarity : rarityStyle("base"),
      frontUrl: cards.data?.[ep.id]?.front ?? null,
      // The event's universal back while face-down, this player's own once it has
      // been turned over. In a real deck every back is identical, and that is
      // exactly what makes a face-down card mean anything.
      backUrl: faceUp ? (cards.data?.[ep.id]?.back ?? null) : (packBack.data?.url ?? null),
      backContent: faceUp ? (
        <CardBackPanel ep={ep} bundle={bundle} rarity={rarity} />
      ) : (
        <SealedFace />
      ),
      caption: faceUp ? (
        <>
          <div className="font-display text-xl font-black uppercase leading-tight tracking-wide">
            {name}
          </div>
          <div
            className="text-[11px] font-bold uppercase tracking-[0.25em]"
            style={{ color: rarity.accent }}
          >
            {rarity.label}
          </div>
          {packedByLabel(pullCounts.data?.[ep.id]) && (
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {packedByLabel(pullCounts.data?.[ep.id])}
            </div>
          )}
        </>
      ) : null,
    };
  })();

  const stagePosition = stage
    ? stage.index === SECRET_STAGE_INDEX
      ? stageTotal
      : stage.index + 1
    : 0;
  const stageOrigin =
    stage && stage.index === 0 && revealed.length === 0
      ? wrapperRectRef.current
      : (slotsRef.current.get(stage?.index ?? -99)?.getBoundingClientRect() ?? null);
  const stageTarget = stage
    ? (slotsRef.current.get(stage.index)?.getBoundingClientRect() ?? null)
    : null;

  const startAuto = useCallback(() => {
    setAuto(true);
    // Nothing on the board yet means nothing has been sent up either — this is
    // the resumed-after-reload path, where the stage is closed and the next
    // face-down card has to be put on it before anything can advance.
    if (!stage) {
      const next = nextStage(revealed);
      if (next) {
        setStageFlipped(false);
        setStage(next);
      }
    }
  }, [stage, nextStage, revealed]);

  // The sealed pack must not flash on a day already opened, so nothing renders
  // until the stored state has been read.
  if (!stateLoaded) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div
        className="mx-auto max-w-4xl px-4 py-6"
        // Rather than a focus trap: the stage has two focusables and a trap would
        // be over-engineering. This also stops a stray tap reaching the board
        // through the scrim.
        inert={stage != null}
      >
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
            <div className="font-display text-lg font-black text-primary">
              {collectedCount} / {total}
            </div>
          </div>
        </div>

        {!torn ? (
          // Tight on purpose. The swipe starts low on the pack, so the whole pack
          // has to sit above the fixed nav — copy that pushes its bottom half off
          // screen does not just look cramped, it puts the gesture out of reach.
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="text-center">
              <h1 className="font-display text-3xl font-black uppercase leading-none">
                Today&apos;s Pack
              </h1>
              <p className="mt-2 max-w-sm text-xs text-muted-foreground">
                One pack a day, dealt to you and nobody else. Swipe up to rip it open.
              </p>
            </div>

            <PackWrapper
              backUrl={packBack.data?.url ?? null}
              cardCount={PACK_SIZE}
              year={event?.year ?? null}
              seed={seed ?? ""}
              onTear={tearOpen}
            />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="font-display text-2xl font-black uppercase leading-none">
                {allRevealed ? "Pack Complete" : "Tap to Reveal"}
              </h1>
            </div>

            <PackBoard
              cards={boardCards}
              revealed={revealed}
              sealedBackUrl={packBack.data?.url ?? null}
              hiddenIndex={stage && !isSecretStage ? stage.index : null}
              registerSlot={registerSlot}
              onOpen={openStage}
            />

            <PackSecretSlot
              slot={secretSlot}
              card={secret}
              rarity={secretRarity}
              duplicate={secretDuplicate}
              peeking={false}
              pulledCount={status.data?.pulled ?? 0}
              hidden={isSecretStage}
              registerSlot={(el) => registerSlot(SECRET_STAGE_INDEX, el)}
              onReveal={() => openStage(SECRET_STAGE_INDEX)}
              onRetry={() => {
                pullFiredRef.current = false;
                setSecretFailed(false);
                // Flipping this back off re-runs the pull effect, whose latch was
                // just cleared.
                setSecretPulling(false);
              }}
            />

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {/* Exactly one "Reveal all" exists at a time — the stage carries its
                  own while the ceremony is running. Two would be ambiguous to a
                  person and fatal to Playwright's strict mode. */}
              {stage == null && !allRevealed && (
                <button
                  onClick={startAuto}
                  className="rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:border-primary/50 hover:text-primary"
                >
                  Reveal all
                </button>
              )}
              {allRevealed && (
                <Link to="/players" className="neon-btn !px-4 !py-2 !text-xs">
                  <PackageOpen className="h-4 w-4" />
                  Back to the vault
                </Link>
              )}
            </div>

            {allRevealed && (
              <p className="text-center text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                {secretRevealed
                  ? "That's today's pack, secret and all — come back tomorrow"
                  : "That's today's pack — come back tomorrow"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Deliberately a sibling of the page container rather than inside it:
          `fixed` means "the viewport" only while no ancestor takes a transform,
          filter or perspective. HoloCard sets perspective on every .holo-scene
          and the board's cards carry transforms, so a stage nested in there would
          silently start positioning itself against a card. */}
      {stage && stageCard && (
        <PackStage
          card={stageCard}
          phase={stage.phase}
          flipped={stageFlipped}
          glow={stage.phase === "entering" && holdBeforeFlip(stage.index) > 0}
          originRect={stageOrigin}
          targetRect={stageTarget}
          position={stagePosition}
          total={stageTotal}
          onFlip={handleFlip}
          onEntered={handleEntered}
          onAdvance={sendToBoard}
          onLanded={handleLanded}
          onRevealAll={auto ? null : startAuto}
        />
      )}
    </div>
  );
}

/**
 * The wax-foil back, for an event that never uploaded one.
 *
 * Stage-sized rather than reusing SealedBack, which is drawn for a ~170px board
 * slot and reads as a postage stamp blown up at 85vw.
 */
function SealedFace() {
  return (
    <div className="wax-foil flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="font-display text-[10px] font-black uppercase tracking-[0.35em] text-primary/80">
        Will YOU Be My Hero?
      </div>
      <div className="font-display text-2xl font-black uppercase leading-none text-foreground/90">
        Draft Combine
      </div>
    </div>
  );
}

function SecretCaption({
  name,
  duplicate,
  rarity,
  pulledCount,
}: {
  name: string;
  duplicate: boolean;
  rarity: Rarity;
  pulledCount: number;
}) {
  return (
    <>
      <div className="font-display text-xl font-black uppercase leading-tight tracking-wide">
        {name}
      </div>
      {duplicate ? (
        <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
          Already yours — you&apos;ve pulled the whole set. This one&apos;s just showing off.
        </div>
      ) : (
        <div
          className="text-[9px] font-bold uppercase tracking-[0.25em]"
          style={{ color: rarity.accent }}
        >
          {/* Taught once, on the first secret anyone ever pulls. Without it the
              empty vault shelf afterwards reads as a bug. */}
          {pulledCount <= 1
            ? "Secret · Not on the roster. Nobody knows how many there are."
            : "Secret · Yours for good, even on a new phone."}
        </div>
      )}
    </>
  );
}
