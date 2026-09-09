import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Settings, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AccountPanel } from "@/components/account-panel";
import { DustChip } from "@/components/dust-chip";
import { SectionTitle } from "@/components/section-title";
import { StreakLadder } from "@/components/streak-ladder";
import { useActiveEvent } from "@/hooks/use-active-event";
import { useCollectionTrophies } from "@/hooks/use-collection-trophies";
import { useDustBalance } from "@/hooks/use-dust";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useMyCollection } from "@/hooks/use-my-collection";
import { useMySecrets, useSecretActor } from "@/hooks/use-daily-secret";
import { useSecretCollections } from "@/hooks/use-secret-collections";
import { useStreakStatus } from "@/hooks/use-streak";
import { packsOpenedLabel } from "@/lib/card-pulls";
import { useCardSfx, useHaptics } from "@/lib/card-sfx";
import { trophiesFor } from "@/lib/collection-trophies";
import { dustLive } from "@/lib/dust";
import { requestGyroAccess, setTiltWanted, useTiltWanted } from "@/lib/gyro";
import { useMemberSession, WAS_MEMBER_KEY } from "@/lib/member-token";
import { groupBySecretCollection } from "@/lib/secret-cards";
import { getStreakHistory, type StreakHistoryEntry } from "@/lib/streaks.functions";
import { vaultSummaryLine } from "@/lib/vault-summary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/you")({
  head: () => ({
    meta: [
      { title: "You — Will YOU Be My Hero?" },
      {
        name: "description",
        content: "Your player, your account, your streak and what this phone sounds like.",
      },
      // Nothing here is anybody else's business, and half of it is only true for
      // the phone it is read on. Same posture as /claim and /admin.
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Will YOU Be My Hero? — You" },
      { property: "og:description", content: "Your player, your streak and your settings." },
    ],
  }),
  component: YouPage,
});

/**
 * Everything about you, in one place.
 *
 * The audit's §4 complaint was that the profile had no home: the account lived
 * in a header dropdown, the claim code on /claim, sound on the pack screen and
 * again in the player page's overflow, tilt in that same overflow and nowhere
 * else, and haptics had no switch at all. Every one of those is a setting you
 * change once and then want to find again, and "wherever you last saw it" is not
 * a place.
 *
 * It has no tab, deliberately. The bar belongs to the cards and the commissioner
 * decides what else is on it (see nav.ts); this is what the header's person icon
 * is for, which is where an account has always lived.
 *
 * Read-only about the collection, and about the streak. Nothing here mints a
 * session, opens a pack, or claims a rung — those all have a screen already, and
 * a second button for a once-a-day action is a second way for it to half-happen.
 */
function YouPage() {
  const member = useMemberSession();
  const actor = useSecretActor();
  const { event, bundle, loading: eventLoading } = useEventBundle();
  const activeEvent = useActiveEvent().data;
  const dustOn = dustLive(activeEvent ?? event);
  // Gated twice, the way the vault gates it: a balance nobody can hold and
  // nowhere to spend it is a round trip for a chip that will not render.
  const dust = useDustBalance(dustOn ? member?.participantId : null);

  const streakQuery = useStreakStatus(actor);
  const history = useStreakHistory(actor);

  const secrets = useMySecrets(actor);
  const collections = useSecretCollections();
  const allTrophies = useCollectionTrophies();
  const rosterIds = useMemo(() => (bundle?.participants ?? []).map((p) => p.id), [bundle]);
  // Third argument as the vault passes it, and for the same reason: without it
  // a league with no combine on never settles, so `ready` never turns true and
  // this screen counts your cards forever.
  const mine = useMyCollection(event?.id ?? null, rosterIds, !event && !eventLoading);

  // Set on claim and never cleared, so somebody reading this on a new phone is
  // told where their cards went. Read in an effect: SSR has no localStorage.
  const [wasMember, setWasMember] = useState(false);
  useEffect(() => {
    setWasMember(localStorage.getItem(WAS_MEMBER_KEY) === "1");
  }, []);

  const myTrophies = trophiesFor(allTrophies.data?.trophies ?? [], member?.participantId ?? null);
  const ownedSecrets = secrets.data?.cards ?? [];
  const summary = mine.ready
    ? vaultSummaryLine({
        rosterHeld: mine.collectedCount,
        rosterSize: rosterIds.length,
        secrets: secrets.data?.pulled ?? 0,
        // Its own grouping, exactly as the vault does it: how many sets your
        // cards came from, never how many sets there are.
        sets: groupBySecretCollection(ownedSecrets, collections).length,
        complete: myTrophies.length,
      })
    : null;
  const packs = packsOpenedLabel(mine.packsOpened);
  const spares = mine.dupes;

  return (
    <div className="card-bg min-h-[var(--page-min-h)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <UserRound className="h-5 w-5" />
            <span className="font-display text-badge font-bold uppercase tracking-[0.08em]">
              Your corner
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">You</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Who this phone is, what your streak has paid, and how loud any of it gets.
          </p>
        </div>

        <div className="space-y-section-gap">
          <section>
            <SectionTitle label="Player" />
            <div className="surface-panel rounded-xl border border-primary/20 p-4">
              <p className="font-display text-xl font-black uppercase leading-none">
                {member?.name ?? "No player claimed"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {member
                  ? "Your player code is claimed on this phone. Your cards are filed under your name, so they follow you to another one."
                  : wasMember
                    ? "This phone has been signed in before. Your cards are on your name, not on the handset — put the code back in to see them."
                    : "Nothing is claimed here yet. A player code turns this phone into your collection."}
              </p>
              <Link to="/claim" className="neon-btn-sm mt-3 inline-flex">
                {member ? "Switch player" : "Claim your player"}
              </Link>
            </div>
          </section>

          <section>
            <SectionTitle label="Account" />
            <AccountPanel />
          </section>

          <section>
            <SectionTitle label="Streak" />
            <StreakLadder
              streak={streakQuery.data}
              history={history.data ?? []}
              historyLoading={history.isPending && !!actor}
            />
          </section>

          <section>
            <SectionTitle label="Collection" />
            {summary ? (
              <p className="text-sm">{summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Counting your cards…</p>
            )}
            {/* The two counters PR 5 took off the vault's header. They belong to
                somebody looking themselves up, not to the screen whose job is
                "what should I do right now". */}
            <p className="mt-1 text-meta text-muted-foreground">
              {[packs, spares > 0 ? `${spares} spare${spares === 1 ? "" : "s"} to trade` : null]
                .filter(Boolean)
                .join(" · ") || "No packs opened yet."}
            </p>
          </section>

          {dustOn && (
            <section>
              <SectionTitle label="Dust" />
              <div className="flex flex-wrap items-center gap-3">
                <DustChip balance={dust.data?.balance} to="/players/shop" />
                <p className="text-sm text-muted-foreground">
                  Burn spares into dust, then spend it in the shop.
                </p>
              </div>
            </section>
          )}

          <section>
            <SectionTitle label="This phone" />
            <div className="surface-panel divide-y divide-white/5 rounded-xl border border-primary/20 px-4">
              <SoundRow />
              <HapticsRow />
              <TiltRow />
            </div>
            <p className="mt-2 text-meta text-muted-foreground">
              {/* Said once here rather than three times above: all three are
                  stored on the handset, which is also why they survive a sign-out
                  and do not follow you to another phone. */}
              These three are remembered on this device only.
            </p>
          </section>

          <section>
            {/* Styled down to utility rather than given a panel, the same way the
                League hub carries it: the commissioner knows where this is, and
                everybody else tapping it hits the PIN. */}
            <Link
              to="/admin"
              className="inline-flex min-h-11 items-center gap-1.5 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-primary"
            >
              <Settings className="h-3.5 w-3.5" />
              Admin
              <span className="font-sans tracking-normal opacity-70">— commissioner tools</span>
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Every rung this actor has ever cashed, and the card it paid.
 *
 * Its own hook rather than one in src/hooks, because exactly one screen asks:
 * this is a history somebody opened deliberately, not a number the chrome needs.
 * Same conventions as useStreakStatus next door — gated on the actor so a phone
 * with no identity never asks, and `retry: false` so an expired token shows an
 * empty list rather than three spinners.
 */
function useStreakHistory(actorId: string | null) {
  const fn = useServerFn(getStreakHistory);
  return useQuery({
    queryKey: ["streak-history", actorId] as const,
    queryFn: () => fn() as Promise<StreakHistoryEntry[]>,
    enabled: !!actorId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * One setting, as a row you can hit with a thumb.
 *
 * A row rather than a switch beside a label: a shadcn Switch is a 24px button,
 * and every button on this page is measured against the 44px floor by
 * e2e/smoke.spec.ts. Making the whole row the control clears it and gives the
 * setting a target the width of the phone.
 *
 * No `role="button"` — see the note on SoundToggle. `aria-pressed` carries the
 * state, and the word on the right carries it for everybody else.
 */
function SettingRow({
  label,
  hint,
  on,
  onWord = "On",
  offWord = "Off",
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onWord?: string;
  offWord?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-badge font-bold uppercase tracking-[0.08em]">
          {label}
        </span>
        <span className="block text-meta text-muted-foreground">{hint}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-3 py-1 text-meta font-bold uppercase tracking-[0.08em]",
          on ? "border-primary/60 text-primary" : "border-white/15 text-muted-foreground",
        )}
      >
        {on ? onWord : offWord}
      </span>
    </button>
  );
}

function SoundRow() {
  const sfx = useCardSfx();
  return (
    <SettingRow
      label="Sound"
      hint="Chimes, tears and card stock."
      on={!sfx.muted}
      onToggle={sfx.toggle}
    />
  );
}

function HapticsRow() {
  const haptics = useHaptics();
  return (
    <SettingRow
      label="Haptics"
      hint="The tap the handset gives back on a flip."
      on={!haptics.off}
      onToggle={haptics.toggle}
    />
  );
}

function TiltRow() {
  const wanted = useTiltWanted();

  // The permission is asked for HERE, in the tap, because iOS only grants
  // orientation from a gesture — and this is the only gesture there is going to
  // be. Turning it off needs no permission, so it never asks.
  const toggle = useCallback(() => {
    if (wanted) {
      setTiltWanted(false);
      return;
    }
    void (async () => {
      const access = await requestGyroAccess();
      if (access === "granted") {
        setTiltWanted(true);
        return;
      }
      // The two failures are genuinely different and the fix for one is not the
      // fix for the other, so they are told apart — same wording the player
      // page's chip has used since tilt shipped.
      toast.error(
        access === "denied"
          ? "Motion access denied"
          : "This device has no motion sensor — try it on a phone.",
      );
    })();
  }, [wanted]);

  return (
    <SettingRow
      label="Tilt"
      hint="Lean the card by tilting the phone."
      on={wanted}
      onToggle={toggle}
    />
  );
}

export default YouPage;
