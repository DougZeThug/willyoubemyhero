import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { PackageOpen, UserRound } from "lucide-react";
import { useIsPresenting } from "@/hooks/use-presentation";
import { useTradeBadge } from "@/hooks/use-trade-badge";
import { useSecretActor } from "@/hooks/use-daily-secret";
import { usePackProgress } from "@/hooks/use-pack-progress";
import { usePackStatus } from "@/hooks/use-pack-status";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { packWaiting as packStillSealed } from "@/lib/pack";
import { activeTab, navTabs, type NavRowId } from "@/lib/nav";
import { useActiveEvent } from "@/hooks/use-active-event";
import { useNavShape } from "@/lib/nav-shape";
import { cn } from "@/lib/utils";

export function SiteNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Rendered by __root.tsx on every screen, so this is also where the app joins
  // its own nudge topic — useTradeBadge carries the subscription.
  const tradeUnread = useTradeBadge();
  // The other thing that arrives while you are looking at something else. Cheap
  // to ask from up here: the query is disabled until a token resolves, it opens
  // no realtime channel, and /players holds the same key — so the vault and the
  // nav share one round trip rather than making two.
  const packStatus = usePackStatus(useSecretActor());
  const packWaiting = packStillSealed(packStatus.data);
  // The third state on the Pack tab, and deliberately not a third dot: a dot
  // says "something is waiting" and this says "you are already in it". The
  // stored pack row is the same one the vault reads for "Finish your pack", so
  // the bar and the Today card can never disagree about which it is.
  //
  // It reads IndexedDB rather than the network, but it does reach usePackIdentity,
  // which mints a device id if there is not one — so the shell now mints on every
  // screen rather than only on the vault. Cheap in practice: `/` redirects to
  // /players, which has always minted one, and the only person newly affected is
  // somebody who lands straight on /tv or /leaderboard and never opens the cards.
  const packTorn = usePackProgress().state === "torn";
  // Which rows the bar holds: the shop answers to the dust switch, the rest to
  // the commissioner's hidden set. Both ride the same event, so this is one read
  // and not two. useActiveEvent rather than useEventBundle on purpose — see the
  // note on that hook: the bundle one opens a realtime channel, and this
  // component renders on every screen. It shares the bundle's query key, so on
  // any page that already has the event this is a cache read rather than a
  // request.
  const event = useActiveEvent().data;
  // Through the device store rather than straight off the event: until the query
  // answers, the bar draws the shape this device last saw instead of the
  // five-row default, so a league with dust on stops gaining a sixth tab — and
  // narrowing every other one — a beat after the page arrives.
  const links = navTabs(useNavShape(event));
  // A screen playing something cinematic gets the whole device. Faded and inert
  // rather than unmounted: unmounting the header reflows every page under it, and
  // the flag flips mid-ceremony. `inert` is the load-bearing half — chrome dimmed
  // to nothing is still chrome a thumb or a tab key can reach.
  const presenting = useIsPresenting();
  const reduced = usePrefersReducedMotion();
  // Fading *out* is part of the ceremony taking the screen. Coming back is not:
  // `inert` lifts the moment the flag clears, so a 300ms fade-in would leave the
  // nav tappable and focusable while it was still invisible.
  const step = { duration: reduced || !presenting ? 0 : 0.3, ease: "easeOut" } as const;
  const active = activeTab(
    path,
    links.map((l) => l.to),
  );

  /**
   * What, if anything, is waiting behind a tab.
   *
   * Two independent cues on two different tabs, which is why this is a lookup
   * rather than the old single `TRADE_PARENT` test. The wording is the whole
   * badge as far as a screen reader is concerned — the dot is aria-hidden — so
   * each one has to name its own thing rather than share a generic "something
   * is waiting".
   */
  const badge = (id: NavRowId): { suffix: string; color?: string } | null => {
    if (id === "trade" && tradeUnread > 0) return { suffix: "a trade offer is waiting" };
    // "Unopened", not "a secret is waiting": whether a secret is in the pack is
    // the pack's news to break, and the cue is the app's own cyan for the same
    // reason.
    if (id === "pack" && packWaiting) return { suffix: "today's pack is unopened" };
    return null;
  };

  return (
    <>
      {/* Top brand bar — centered wordmark, no logo tile */}
      <motion.header
        inert={presenting}
        animate={{ opacity: presenting ? 0 : 1 }}
        transition={step}
        // pt-safe: the notch sits over a sticky header, so the bar owes it the
        // same room the bottom nav already gives the home indicator. px-safe is
        // for landscape, where the notch is beside the content rather than above
        // it — zero in portrait, so it costs nothing on the common case.
        className="sticky top-0 z-30 border-b border-primary/10 bg-background/85 pt-safe px-safe backdrop-blur"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5 sm:gap-4">
          <div className="w-11 md:w-16" aria-hidden />
          {/* Tracking loosens with the viewport rather than the wordmark wrapping:
              two stacked lines turned the 48px header into 90px at 320px. The
              wide desktop step is the one place under 14px that keeps tracking
              above the 0.08em cap (§16) — the cap is aimed at labels and
              metadata, and this is the wordmark. */}
          <Link
            to="/players"
            className="flex min-h-11 flex-col items-center justify-center leading-none"
          >
            <span className="whitespace-nowrap text-nav font-semibold uppercase tracking-[0.08em] text-primary/80 sm:tracking-[0.35em]">
              Will YOU Be My Hero?
            </span>
            <span className="whitespace-nowrap font-display text-base font-black uppercase tracking-[0.1em] text-foreground sm:text-lg sm:tracking-[0.22em]">
              Trading Cards
            </span>
          </Link>
          <nav aria-label="Sections" className="hidden gap-1 md:flex">
            {links.map((l) => {
              const waiting = badge(l.id);
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  // The active tab was conveyed by colour alone, so a screen
                  // reader had no way to know which page it was on.
                  aria-current={active === l.to ? "page" : undefined}
                  aria-label={waiting ? `${l.label} — ${waiting.suffix}` : undefined}
                  className={cn(
                    // Above md the bottom bar is gone and this row IS the
                    // navigation — including on a phone turned sideways, which
                    // is 844px wide and still a thumb. 32px was fine while this
                    // was only ever a mouse's row; the pointer rule is what
                    // makes that true.
                    "relative inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors pointer-fine:min-h-0",
                    active === l.to
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  {l.label}
                  {waiting && <WaitingDot className="right-0.5 top-0.5" color={waiting.color} />}
                </Link>
              );
            })}
          </nav>
          <ProfileLink current={path === "/you"} />
        </div>
      </motion.header>

      {/* Mobile bottom nav — thin icons, cyan underline glow when active */}
      <motion.nav
        inert={presenting}
        animate={{ opacity: presenting ? 0 : 1 }}
        transition={step}
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-primary/15 bg-background/95 pb-safe px-safe backdrop-blur md:hidden"
      >
        {/* flex rather than grid: the row count is whatever the commissioner has
            left switched on, and Tailwind scans source for literals — a computed
            `grid-cols-${n}` emits no rule at all, and a lookup map would need a
            new entry every time the bar grows. Equal `flex-1` cells give the same
            layout the grid did at every count, which is what the desktop bar
            above already relies on. */}
        <ul className="mx-auto flex max-w-md">
          {links.map((l) => {
            // A pack halfway through its reveal wears the torn glyph. The
            // resting one is a sealed pack, which is what makes the swap read as
            // an event rather than as a different tab.
            const Icon = l.id === "pack" && packTorn ? PackageOpen : l.icon;
            const waiting = badge(l.id);
            return (
              <li key={l.to} className="min-w-0 flex-1">
                <Link
                  to={l.to}
                  aria-current={active === l.to ? "page" : undefined}
                  aria-label={waiting ? `${l.label} — ${waiting.suffix}` : undefined}
                  className={cn(
                    // whitespace-nowrap is the bar's height contract: six rows
                    // at 320px leave each tile ~53px, and a label that wrapped
                    // to a second line grew the bar past the room `main`
                    // reserves for it and pushed every page under it.
                    //
                    // The press is spelled out rather than promoted: this tile
                    // is the most-pressed control in the app and has never
                    // carried a hover: for styles.css's variant to promote. A
                    // fill, not a bloom (§15), and not cyan — cyan plus the bar
                    // below is how this row says "you are here", and a press is
                    // not that. It is the same white/5 the desktop row's hover
                    // wears, which is what that row's press now resolves to.
                    "relative flex flex-col items-center gap-1 whitespace-nowrap rounded-md py-2.5 text-nav font-bold uppercase tracking-[0.08em] transition-colors active:bg-white/5",
                    active === l.to ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                  {l.label}
                  {/* Offset from the icon rather than the tile, so it reads as a
                      badge on the glyph instead of drifting into the neighbour. */}
                  {waiting && (
                    <WaitingDot
                      className="right-[calc(50%-1.05rem)] top-1.5"
                      color={waiting.color}
                    />
                  )}
                  {/* The bar alone, no bloom (§15). Cyan is the interactive
                      colour and it keeps its glow on the primary CTA only —
                      everywhere else it was a second light source competing
                      with the card art. The colour change on the icon and the
                      label already carries "you are here"; the bar makes it
                      unmissable without lighting the room. */}
                  {active === l.to && (
                    <span
                      aria-hidden
                      className="absolute -top-px left-1/2 h-[2px] w-10 -translate-x-1/2 rounded-full bg-primary"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </motion.nav>
    </>
  );
}

/**
 * The "something is waiting" dot, same 2.5 units and same placement language as
 * the secret-card dot on the pack button in vault-hero.tsx. Never carries the
 * count: the number is not the point, and a numeral at this size is a smudge.
 *
 * `color` so the pack's dot can wear the secret set's own edge rather than the
 * app's cyan — two cues in one bar reading as the same thing is worse than one.
 * Primary is the default, which keeps the trade dot exactly as it was.
 *
 * aria-hidden because the link's own aria-label says it in words.
 */
function WaitingDot({ className, color }: { className?: string; color?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        // A dark hairline instead of a bloom: the dot sits on a glyph, and it
        // needs to survive a light pixel underneath it, which is what the glow
        // was actually doing. A ring does that for one pixel instead of eight.
        "absolute h-2.5 w-2.5 rounded-full ring-1 ring-background",
        !color && "bg-primary",
        className,
      )}
      style={color ? { background: color } : undefined}
    />
  );
}

/**
 * The way in to /you.
 *
 * It used to be a dropdown that only existed while signed in, holding two links,
 * an admin shortcut and the app's only sign-out. All four moved to /you, which
 * is a screen a signed-out person can also read — the menu's own state was the
 * thing that made "where do I change this" have two answers.
 *
 * One glyph in both states, and it is the person rather than the old sign-in
 * arrow: the destination no longer depends on whether there is an account behind
 * it. `aria-current` because /you has no tab to light, and "say which page you
 * are on" is a rule the whole app keeps.
 */
function ProfileLink({ current }: { current: boolean }) {
  return (
    <Link
      to="/you"
      aria-label="You"
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex h-11 w-11 items-center justify-center transition-colors hover:text-primary md:w-16 md:justify-end",
        current ? "text-primary" : "text-muted-foreground",
      )}
    >
      <UserRound className="h-5 w-5" strokeWidth={1.75} />
    </Link>
  );
}
