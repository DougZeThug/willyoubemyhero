import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings, Trophy } from "lucide-react";
import { LEAGUE_LINKS } from "@/lib/league";

export const Route = createFileRoute("/league")({
  head: () => ({
    meta: [
      { title: "The League — Will YOU Be My Hero?" },
      {
        name: "description",
        content: "Race-day timing, running order, draft picks, superlatives and the stat archive.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? — The League" },
      { property: "og:description", content: "Everything the combine leaves behind." },
    ],
  }),
  component: LeaguePage,
});

/**
 * Deliberately fetches nothing.
 *
 * Every screen behind these tiles loads its own data, the board is one tab away,
 * and a hub that spinners on the way to a screen nobody visits between combines
 * is a loading state bought with nothing.
 */
function LeaguePage() {
  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <Trophy className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              Combine
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">
            The League
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            The combine sleeps until next summer. The cards don't.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LEAGUE_LINKS.map((l) => {
            const Icon = l.icon;
            return (
              <Link
                key={l.to}
                to={l.to}
                className="hud-bezel rounded-xl border border-primary/20 p-4 transition-colors hover:border-primary/50"
              >
                <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                <div className="mt-2 font-display text-sm font-black uppercase tracking-[0.15em]">
                  {l.label}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {l.blurb}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Styled down to utility rather than given a tile: the commissioner
            knows where this is, and everybody else tapping it hits the PIN. */}
        <Link
          to="/admin"
          className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:text-primary"
        >
          <Settings className="h-3.5 w-3.5" />
          Admin
          <span className="font-sans tracking-normal opacity-70">— commissioner tools</span>
        </Link>
      </div>
    </div>
  );
}
