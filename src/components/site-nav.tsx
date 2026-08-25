import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Layers, PackageOpen, ArrowLeftRight, Timer, Trophy, UserRound, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useIsPresenting } from "@/hooks/use-presentation";
import { useTradeBadge } from "@/hooks/use-trade-badge";
import { useSecretActor, useSecretStatus } from "@/hooks/use-daily-secret";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { signOutAccount, useAuthUser } from "@/hooks/use-account";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { secretWaiting, SECRET_RARITY } from "@/lib/secret-cards";
import { activeTab } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The card economy, in nav order, plus the two things it opens onto.
 *
 * The combine is a week a year and the collection is every other day of it, so
 * the first three slots belong to the vault, the pack and the trading post. The
 * board keeps a tab because a card's whole claim to a tier is a time on it; the
 * rest of the combine sits one tap away behind /league, and Admin lives in the
 * account menu where a PIN-gated screen belongs.
 */
const links = [
  { to: "/players", label: "Vault", icon: Layers },
  { to: "/players/pack", label: "Pack", icon: PackageOpen },
  { to: "/players/trade", label: "Trade", icon: ArrowLeftRight },
  { to: "/leaderboard", label: "Board", icon: Timer },
  { to: "/league", label: "League", icon: Trophy },
] as const;

const TABS = links.map((l) => l.to);

export function SiteNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Rendered by __root.tsx on every screen, so this is also where the app joins
  // its own nudge topic — useTradeBadge carries the subscription.
  const tradeUnread = useTradeBadge();
  // The other thing that arrives while you are looking at something else. Cheap
  // to ask from up here: the query is disabled until a token resolves, it opens
  // no realtime channel, and /players holds the same key — so the vault and the
  // nav share one round trip rather than making two.
  const secretStatus = useSecretStatus(useSecretActor());
  const packWaiting = secretWaiting(secretStatus.data);
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
  const active = activeTab(path, TABS);

  /**
   * What, if anything, is waiting behind a tab.
   *
   * Two independent cues on two different tabs, which is why this is a lookup
   * rather than the old single `TRADE_PARENT` test. The wording is the whole
   * badge as far as a screen reader is concerned — the dot is aria-hidden — so
   * each one has to name its own thing rather than share a generic "something
   * is waiting".
   */
  const badge = (to: string): { suffix: string; color?: string } | null => {
    if (to === "/players/trade" && tradeUnread > 0) return { suffix: "a trade offer is waiting" };
    if (to === "/players/pack" && packWaiting)
      return { suffix: "a secret is waiting", color: SECRET_RARITY.border };
    return null;
  };

  return (
    <>
      {/* Top brand bar — centered wordmark, no logo tile */}
      <motion.header
        inert={presenting}
        animate={{ opacity: presenting ? 0 : 1 }}
        transition={step}
        className="sticky top-0 z-30 border-b border-primary/10 bg-background/85 backdrop-blur"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="w-8 md:w-16" aria-hidden />
          <Link to="/players" className="flex flex-col items-center leading-none">
            <span className="text-[9px] font-semibold uppercase tracking-[0.35em] text-primary/80">
              Will YOU Be My Hero?
            </span>
            <span className="font-display text-lg font-black uppercase tracking-[0.22em] text-foreground">
              Trading Cards
            </span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {links.map((l) => {
              const waiting = badge(l.to);
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  aria-label={waiting ? `${l.label} — ${waiting.suffix}` : undefined}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors",
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
          <AccountMenu />
        </div>
      </motion.header>

      {/* Mobile bottom nav — thin icons, cyan underline glow when active */}
      <motion.nav
        inert={presenting}
        animate={{ opacity: presenting ? 0 : 1 }}
        transition={step}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-primary/15 bg-background/95 backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {links.map((l) => {
            const Icon = l.icon;
            const waiting = badge(l.to);
            return (
              <li key={l.to}>
                <Link
                  to={l.to}
                  aria-label={waiting ? `${l.label} — ${waiting.suffix}` : undefined}
                  className={cn(
                    "relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors",
                    active === l.to ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      active === l.to && "drop-shadow-[0_0_6px_var(--color-primary)]",
                    )}
                    strokeWidth={1.75}
                  />
                  {l.label}
                  {/* Offset from the icon rather than the tile, so it reads as a
                      badge on the glyph instead of drifting into the neighbour. */}
                  {waiting && (
                    <WaitingDot
                      className="right-[calc(50%-1.05rem)] top-1.5"
                      color={waiting.color}
                    />
                  )}
                  {active === l.to && (
                    <span
                      aria-hidden
                      className="absolute -top-px left-1/2 h-[2px] w-10 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_10px_var(--color-primary)]"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
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
        "absolute h-2.5 w-2.5 rounded-full",
        !color && "bg-primary shadow-[0_0_8px_var(--color-primary)]",
        className,
      )}
      style={color ? { background: color, boxShadow: `0 0 8px ${color}` } : undefined}
    />
  );
}

/**
 * Session-driven sign-in affordance.
 *
 * Rendered from the auth session rather than as a static "Sign in" link: a header
 * that still says "Sign in" after a successful sign-in reads as a broken login.
 */
function AccountMenu() {
  const { user } = useAuthUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (!user) {
    return (
      <Link
        to="/auth"
        aria-label="Sign in"
        className="flex w-8 items-center justify-center text-muted-foreground transition-colors hover:text-primary md:w-16 md:justify-end"
      >
        <LogIn className="h-5 w-5" strokeWidth={1.75} />
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex w-8 items-center justify-center text-primary transition-opacity hover:opacity-80 md:w-16 md:justify-end"
      >
        <UserRound className="h-5 w-5" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {user.email ?? "Signed in"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: "/auth" })}>Account</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: "/claim" })}>
          Player code
        </DropdownMenuItem>
        {/* Off the bar and in here now that the tabs belong to the cards. Shown
            to anybody signed in rather than to a commissioner we cannot identify
            from the client: /admin is PIN-gated, so the worst a curious member
            finds is the PIN prompt. A signed-out commissioner still has the
            League hub's admin row. */}
        <DropdownMenuItem onSelect={() => void navigate({ to: "/admin" })}>Admin</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void (async () => {
              // Cancel before the sign-out so in-flight queries don't land as errors,
              // and clear so Back cannot restore a shell hydrated from this account.
              await queryClient.cancelQueries();
              queryClient.clear();
              await signOutAccount();
              toast.success("Signed out");
              void navigate({ to: "/auth", replace: true });
            })();
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
