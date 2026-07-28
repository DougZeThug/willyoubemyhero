import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Lock, PackageOpen, Sparkles } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { mySecretsKey, secretStatusKey, useSecretStatus } from "@/hooks/use-daily-secret";
import { HoloCard } from "@/components/holo-card";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { rarityMap, rarityStyle, type Rarity } from "@/lib/card-rarity";
import { collectCard, loadCollection, loadPackState, savePackState } from "@/lib/card-collection";
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
import { dealPack, packSeed } from "@/lib/pack";
import { recordCardPulls } from "@/lib/card-pulls.functions";
import { cardPullCountsKey, useCardPullCounts } from "@/hooks/use-card-pulls";
import { packedByLabel } from "@/lib/card-pulls";
import { seededRng } from "@/lib/format";
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
/** Drag distance, as a fraction of the pack width, that completes the tear. */
const TEAR_THRESHOLD = 0.55;

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

/** Local date key so the pack rolls over at midnight in the user's own timezone. */
function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * How the fourth slot is doing.
 *
 * Derived rather than kept as four booleans, two of which could be true at once.
 * The order matters: a pull that succeeds after a failure lands straight on
 * "sealed" rather than staying stuck on the error.
 */
type SecretSlot = "hidden" | "gated" | "pending" | "failed" | "sealed" | "open";

/**
 * A ragged tear edge, deterministic for a given seed so the same pack always
 * tears the same way.
 */
function tearPolygon(rng: () => number, progress: number): string {
  const steps = 14;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 100;
    const jitter = (rng() - 0.5) * 9;
    points.push(`${x.toFixed(1)}% ${Math.max(0, progress * 100 + jitter).toFixed(1)}%`);
  }
  return `polygon(0% 0%, 100% 0%, ${[...points].reverse().join(", ")})`;
}

/** Generic card back shown while a pulled card is still face-down. */
function SealedBack() {
  return (
    <div className="wax-foil flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
      <Sparkles className="h-5 w-5 text-primary/80" />
      <div className="font-display text-[8px] font-black uppercase tracking-[0.3em] text-primary/80">
        Will YOU Be My Hero?
      </div>
      <div className="font-display text-sm font-black uppercase leading-none text-foreground/90">
        Draft Combine
      </div>
    </div>
  );
}

/**
 * The fourth slot.
 *
 * Appended below the three, never a replaced slot: `nextPack` swaps its *last*
 * entry for a card the user has not collected, and that swap is the only
 * mechanism by which the thirteen-card set ever completes. It also keeps
 * PackState.ids at exactly three roster ids, which is what the e2e suite asserts.
 */
function SecretSlotView({
  slot,
  card,
  rarity,
  duplicate,
  peeking,
  pulledCount,
  onReveal,
  onRetry,
}: {
  slot: SecretSlot;
  card: SecretCardView | null;
  rarity: Rarity;
  duplicate: boolean;
  peeking: boolean;
  pulledCount: number;
  onReveal: () => void;
  onRetry: () => void;
}) {
  if (slot === "hidden") return null;

  return (
    <div className="mx-auto flex w-full max-w-[220px] flex-col items-center gap-2 pt-2">
      <div className="text-center">
        <h2
          className="font-display text-sm font-black uppercase tracking-[0.2em]"
          style={{ color: rarity.accent }}
        >
          One More Card
        </h2>
        {slot === "gated" && (
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            Claim your player to open it. Ask whoever&apos;s running the combine for your code.
          </p>
        )}
        {(slot === "sealed" || slot === "pending") && !peeking && (
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            {slot === "pending"
              ? "Checking the wrapper…"
              : "Not on the roster. One a day, and it's yours for good."}
          </p>
        )}
        {peeking && (
          <p
            className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em]"
            style={{ color: rarity.accent }}
          >
            Something else…
          </p>
        )}
      </div>

      {slot === "gated" ? (
        // Card-shaped, not a bordered link box — that reads as a cookie banner
        // and gets ignored.
        <Link
          to="/claim"
          className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center"
        >
          <Lock className="h-6 w-6 text-muted-foreground" />
          <span className="font-display text-[10px] font-black uppercase tracking-[0.25em] text-primary">
            Claim your player
          </span>
        </Link>
      ) : slot === "failed" ? (
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
      ) : slot === "sealed" && card ? (
        <div
          // w-full is load-bearing: the column above centres its items, which
          // makes a flex child shrink to its content, and HoloCard sizes itself
          // from its width via aspect-ratio — so without this the card collapses
          // to nothing and the slot renders as a sliver.
          className={cn("relative w-full rounded-xl transition-shadow", peeking && "animate-pulse")}
          style={
            peeking
              ? {
                  // Deliberately thinner than the hit's 6px inset, so it reads as
                  // a different thing rather than as a bigger one.
                  boxShadow: `inset 0 0 0 8px ${rarity.border}, 0 0 70px ${rarity.border}`,
                }
              : { boxShadow: `inset 0 0 0 3px ${rarity.border}, 0 0 20px ${rarity.border}` }
          }
        >
          <motion.div
            animate={peeking ? { scale: 1.06 } : { scale: 1 }}
            transition={{ duration: 0.9 }}
          >
            <HoloCard
              frontUrl={null}
              backUrl={null}
              name="Secret"
              rarity={rarity}
              cacheKey={`secret-sealed-${card.id}`}
              faceDown
              flipped={false}
              interactive={false}
              backContent={<SealedBack />}
              onClick={onReveal}
            />
          </motion.div>
        </div>
      ) : card ? (
        <>
          <div className={cn("relative w-full rounded-xl", duplicate && "secret-dupe-shimmer")}>
            <HoloCard
              frontUrl={card.artUrl}
              backUrl={card.backUrl}
              name={card.name}
              rarity={rarity}
              cacheKey={card.id}
              tilt="hero"
              backContent={<SecretBackPanel card={card} rarity={rarity} />}
            />
          </div>
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
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [peeking, setPeeking] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

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
  const [secretPeeking, setSecretPeeking] = useState(false);
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

  const tearOpen = useCallback(() => {
    if (dealtIds || nextPack.length === 0) return;
    const ids = nextPack.map((p) => p.id);
    setDealtIds(ids);
    playTear();
  }, [dealtIds, nextPack]);

  function onDrag(clientY: number) {
    const el = dragRef.current;
    if (!el || torn) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    setProgress(p);
    if (p >= TEAR_THRESHOLD) tearOpen();
  }

  async function revealAt(i: number) {
    if (revealed.includes(i)) return;
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

      setRevealed((prev) => [...prev, i]);
      playReveal(rarity.tier);
      void collectCard(ep.id, rarity.tier);
      setCollected((prev) => ({ ...prev, [ep.id]: true }));

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

  const secretRarity = secretFoil(secret?.foil);

  async function revealSecret() {
    if (!secret || secretRevealed) return;
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
      navigator.vibrate?.([10, 60, 10, 60, 26]);
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
    });
  }, [dealtIds, dayKey, revealed, secretRevealed, stateLoaded, identity]);

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

  const allPlayerCardsRevealed = pack.length > 0 && revealed.length === pack.length;
  // A slot still working counts as outstanding, or "Pack Complete" flashes for a
  // beat before the fourth card turns up. For a guest, or a pull that failed,
  // this reduces to exactly the old expression.
  const allRevealed = allPlayerCardsRevealed && secretSlot !== "pending" && secretSlot !== "sealed";
  const collectedCount = (bundle?.participants ?? []).filter((p) => collected[p.id]).length;
  const total = bundle?.participants.length ?? 0;

  // The sealed pack must not flash on a day already opened, so nothing renders
  // until the stored state has been read.
  if (!stateLoaded) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-4xl px-4 py-6">
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
          <div className="flex flex-col items-center gap-5 py-6">
            <div className="text-center">
              <h1 className="font-display text-3xl font-black uppercase leading-none">
                Today&apos;s Pack
              </h1>
              <p className="mt-2 max-w-sm text-xs text-muted-foreground">
                One pack a day, dealt to you and nobody else. Refreshing won&apos;t reroll it — drag
                down to rip it open.
              </p>
            </div>

            <div
              ref={dragRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onDrag(e.clientY);
              }}
              onPointerMove={(e) => {
                if (e.buttons > 0) onDrag(e.clientY);
              }}
              onPointerUp={() => {
                if (!torn) setProgress(0);
              }}
              role="button"
              tabIndex={0}
              aria-label="Drag down to open the pack"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  tearOpen();
                }
              }}
              className="wax-foil hud-glow relative aspect-[3/4] w-full max-w-xs cursor-grab touch-none overflow-hidden rounded-2xl border border-primary/40 active:cursor-grabbing"
            >
              {/* The wax foil underneath is the designed fallback, not a spinner:
                  a slow network gets a beautiful pack rather than a grey box, and
                  an event with no uploaded back gets the same thing permanently.
                  The art fades in on top of it, which reads as intentional rather
                  than as a pop. aspect-[3/4] is fixed by class either way, so
                  nothing shifts when it lands. */}
              {packBack.data?.url && (
                <img
                  src={packBack.data.url}
                  alt=""
                  aria-hidden
                  crossOrigin="anonymous"
                  draggable={false}
                  onLoad={(e) => e.currentTarget.style.setProperty("opacity", "1")}
                  className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
                />
              )}
              <div
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
                  // The lettering is the pack's identity only while there is no
                  // art. Over a real back it is a caption nobody asked for.
                  packBack.data?.url && "hidden",
                )}
              >
                <Sparkles className="h-8 w-8 text-primary" />
                <div className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary/90">
                  Will YOU Be My Hero?
                </div>
                <div className="font-display text-3xl font-black uppercase leading-none">
                  Draft Combine
                </div>
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                  {PACK_SIZE} cards · {event?.year ?? ""}
                </div>
              </div>
              {/* Torn-away portion, revealed as the drag progresses. */}
              {progress > 0 && (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-background/85"
                  style={{ clipPath: tearPolygon(seededRng(seed ?? ""), progress) }}
                />
              )}
            </div>

            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Drag down · or press Enter
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="font-display text-2xl font-black uppercase leading-none">
                {allRevealed ? "Pack Complete" : "Tap to Reveal"}
              </h1>
              {peeking && (
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-primary">
                  Last card…
                </p>
              )}
            </div>

            {/* Three across at every width: the whole pack is in view at once on a
                phone, which a two-column grid with an orphan third card was not. */}
            <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2 sm:gap-4">
              {pack.map((ep, i) => {
                const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
                const isRevealed = revealed.includes(i);
                const isHit = i === pack.length - 1;
                const name = ep.participant?.name ?? "—";
                return (
                  <motion.div
                    key={ep.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07, type: "spring", stiffness: 220, damping: 20 }}
                    className="flex flex-col gap-2"
                  >
                    {/* The card owns its own button semantics — wrapping it in
                        another button would nest interactive elements. */}
                    <div
                      className={cn(
                        "rounded-xl transition-shadow",
                        peeking && isHit && "animate-pulse",
                      )}
                      style={
                        peeking && isHit
                          ? {
                              boxShadow: `inset 0 0 0 6px ${rarity.border}, 0 0 40px ${rarity.border}`,
                            }
                          : undefined
                      }
                    >
                      {isRevealed ? (
                        // Uncontrolled once revealed, so it flips freely front to back.
                        <HoloCard
                          frontUrl={cards.data?.[ep.id]?.front ?? null}
                          backUrl={cards.data?.[ep.id]?.back ?? null}
                          name={name}
                          rarity={rarity}
                          cacheKey={ep.id}
                          backContent={<CardBackPanel ep={ep} bundle={bundle} rarity={rarity} />}
                        />
                      ) : (
                        // Real back art, not the wax-foil stand-in: a pack of
                        // cards face-down should look like the deck it came from.
                        //
                        // This makes canFlip true (holo-card.tsx:184), which would
                        // normally arm flick-to-flip. It doesn't here — both the
                        // flick and the click are gated on `!onClick`, and this
                        // card has one. A face-down card still cannot turn itself
                        // over; only a deliberate reveal does that.
                        <HoloCard
                          frontUrl={cards.data?.[ep.id]?.front ?? null}
                          backUrl={cards.data?.[ep.id]?.back ?? null}
                          name={`Card ${i + 1}`}
                          rarity={rarityStyle("base")}
                          cacheKey={ep.id}
                          faceDown
                          flipped={false}
                          interactive={false}
                          backContent={<SealedBack />}
                          onClick={() => void revealAt(i)}
                        />
                      )}
                    </div>
                    <AnimatePresence>
                      {isRevealed && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-center"
                        >
                          <Link
                            to="/players/$id"
                            params={{ id: ep.id }}
                            className="block truncate font-display text-xs font-black uppercase tracking-wide hover:text-primary"
                          >
                            {name}
                          </Link>
                          <div
                            className="text-[9px] font-bold uppercase tracking-[0.25em]"
                            style={{ color: rarity.border }}
                          >
                            {rarity.label}
                          </div>
                          {/* Muted and on its own line: the tier above is what
                              this card is, this is how many people have one. */}
                          {packedByLabel(pullCounts.data?.[ep.id]) && (
                            <div className="text-[8px] font-bold uppercase leading-tight tracking-[0.2em] text-muted-foreground">
                              {packedByLabel(pullCounts.data?.[ep.id])}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            <SecretSlotView
              slot={secretSlot}
              card={secret}
              rarity={secretRarity}
              duplicate={secretDuplicate}
              peeking={secretPeeking}
              pulledCount={status.data?.pulled ?? 0}
              onReveal={() => void revealSecret()}
              onRetry={() => {
                pullFiredRef.current = false;
                setSecretFailed(false);
                // Flipping this back off re-runs the pull effect, whose latch was
                // just cleared.
                setSecretPulling(false);
              }}
            />

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {!allRevealed && (
                <button
                  onClick={async () => {
                    // Sequential so the chimes stagger instead of stacking into noise.
                    for (let i = 0; i < pack.length; i++) {
                      await revealAt(i);
                      await new Promise((r) => setTimeout(r, 260));
                    }
                    // The secret goes last, or its hold lands underneath the hit's
                    // and neither of them reads.
                    await revealSecret();
                  }}
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
                {secretSlot === "open"
                  ? "That's today's pack, secret and all — come back tomorrow"
                  : "That's today's pack — come back tomorrow"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
