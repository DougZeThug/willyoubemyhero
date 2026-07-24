import { Link, useRouterState } from "@tanstack/react-router";
import { Radio, Trophy, ListOrdered, ClipboardList, Settings, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Live", icon: Radio },
  { to: "/leaderboard", label: "Board", icon: Trophy },
  { to: "/order", label: "Order", icon: ListOrdered },
  { to: "/draft", label: "Draft", icon: ClipboardList },
  { to: "/analytics", label: "Stats", icon: BarChart3 },
  { to: "/admin", label: "Admin", icon: Settings },
] as const;

export function SiteNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      {/* Top brand bar — centered wordmark, no logo tile */}
      <header className="sticky top-0 z-30 border-b border-primary/10 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="w-8 md:w-16" aria-hidden />
          <Link to="/" className="flex flex-col items-center leading-none">
            <span className="text-[9px] font-semibold uppercase tracking-[0.35em] text-primary/80">
              Will YOU Be My Hero?
            </span>
            <span className="font-display text-lg font-black uppercase tracking-[0.22em] text-foreground">
              Draft Combine
            </span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {links.map((l) => {
              const active = l.to === "/" ? path === "/" : path.startsWith(l.to);
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
          <div className="w-8 md:hidden" aria-hidden />
        </div>
      </header>

      {/* Mobile bottom nav — thin icons, cyan underline glow when active */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-primary/15 bg-background/95 backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-6">
          {links.map((l) => {
            const Icon = l.icon;
            const active = l.to === "/" ? path === "/" : path.startsWith(l.to);
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
                    className={cn("h-5 w-5", active && "drop-shadow-[0_0_6px_var(--color-primary)]")}
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
      </nav>
      {/* spacer so content doesn't sit under mobile nav */}
      <div className="pointer-events-none h-16 md:hidden" aria-hidden />
    </>
  );
}