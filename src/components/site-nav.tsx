import { Link, useRouterState } from "@tanstack/react-router";
import { Radio, Trophy, ListOrdered, ClipboardList, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Live", icon: Radio },
  { to: "/leaderboard", label: "Board", icon: Trophy },
  { to: "/order", label: "Order", icon: ListOrdered },
  { to: "/draft", label: "Draft", icon: ClipboardList },
  { to: "/admin", label: "Admin", icon: Settings },
] as const;

export function SiteNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      {/* Top brand bar */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <span className="font-display text-lg font-black leading-none">W</span>
            </span>
            <div className="leading-tight">
              <div className="font-display text-lg font-black uppercase tracking-[0.08em] text-foreground">
                Will YOU Be My Hero?
              </div>
              <div className="-mt-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
                Draft Combine
              </div>
            </div>
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
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-background/95 backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {links.map((l) => {
            const Icon = l.icon;
            const active = l.to === "/" ? path === "/" : path.startsWith(l.to);
            return (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-2 text-[10px] font-bold uppercase tracking-wider",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={2.25} />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
      {/* spacer so content doesn't sit under mobile nav */}
      <div className="pointer-events-none h-14 md:hidden" aria-hidden />
    </>
  );
}