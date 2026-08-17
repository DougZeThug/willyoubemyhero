import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Radio,
  Trophy,
  ListOrdered,
  ClipboardList,
  Settings,
  Users,
  UserRound,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";
import { useIsPresenting } from "@/hooks/use-presentation";
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
import { cn } from "@/lib/utils";

const links = [
  { to: "/live", label: "Live", icon: Radio },
  { to: "/leaderboard", label: "Board", icon: Trophy },
  { to: "/order", label: "Order", icon: ListOrdered },
  { to: "/players", label: "Players", icon: Users },
  { to: "/draft", label: "Draft", icon: ClipboardList },
  { to: "/admin", label: "Admin", icon: Settings },
] as const;

export function SiteNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
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
              Draft Combine
            </span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {links.map((l) => {
              const active = path.startsWith(l.to);
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  {l.label}
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
        <ul className="mx-auto grid max-w-md grid-cols-6">
          {links.map((l) => {
            const Icon = l.icon;
            const active = path.startsWith(l.to);
            return (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className={cn(
                    "relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      active && "drop-shadow-[0_0_6px_var(--color-primary)]",
                    )}
                    strokeWidth={1.75}
                  />
                  {l.label}
                  {active && (
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
