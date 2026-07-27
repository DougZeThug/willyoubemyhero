import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getArchivedRecap } from "@/lib/media.functions";
import { formatTime } from "@/lib/format";

export const Route = createFileRoute("/recap/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Recap · ${params.slug} — Draft Combine` },
      {
        name: "description",
        content: "Archived draft combine recap: final leaderboard and draft order.",
      },
      { property: "og:title", content: `Draft Combine Recap · ${params.slug}` },
      { property: "og:description", content: "Final combine results and draft order." },
    ],
  }),
  loader: async ({ params }) => {
    const recap = await getArchivedRecap({ data: { slug: params.slug } });
    if (!recap) throw notFound();
    return recap;
  },
  errorComponent: () => (
    <div className="p-8 text-center text-muted-foreground">Recap failed to load.</div>
  ),
  notFoundComponent: () => (
    <div className="p-8 text-center">
      <p className="text-muted-foreground">No recap found.</p>
      <Link to="/analytics" className="mt-4 inline-block text-primary underline">
        Back to archive
      </Link>
    </div>
  ),
  component: RecapPage,
});

type Snapshot = {
  event: { name: string; year: number | null };
  participants: Array<{
    id: string;
    participant_id: string;
    participant?: { name: string; fantasy_team_name?: string | null } | null;
  }>;
  runs: Array<{
    id: string;
    participant_id: string;
    is_official: boolean;
    official_time_ms: number | null;
  }>;
  drafts: Array<{ selection_order: number; participant_id: string; draft_position: number }>;
};

function RecapPage() {
  // The loader throws notFound() when there is no row, so this is always present.
  // Typed off the server function because useLoaderData doesn't infer it here.
  const recap = Route.useLoaderData() as NonNullable<Awaited<ReturnType<typeof getArchivedRecap>>>;
  const snap = recap.snapshot as Snapshot;
  const results = snap.runs
    .filter((r) => r.is_official)
    .map((r) => {
      const ep = snap.participants.find((p) => p.participant_id === r.participant_id);
      return { run: r, ep };
    })
    .sort((a, b) => (a.run.official_time_ms ?? 0) - (b.run.official_time_ms ?? 0));
  const drafts = [...snap.drafts].sort((a, b) => a.draft_position - b.draft_position);

  return (
    <div className="circuit-bg -mx-4 -mb-8 -mt-4 min-h-[calc(100vh-4.5rem)] px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <div className="font-display text-[10px] font-black uppercase tracking-[0.4em] text-primary">
            Recap · Archived {new Date(recap.created_at).toLocaleDateString()}
          </div>
          <h1 className="font-display text-3xl font-black uppercase leading-none">
            {snap.event.name} {snap.event.year ?? ""}
          </h1>
        </header>

        <section>
          <h2 className="mb-2 font-display text-xs font-black uppercase tracking-[0.32em] text-primary/80">
            Final Leaderboard
          </h2>
          <ol className="space-y-1.5">
            {results.map((r, i) => (
              <li
                key={r.run.id}
                className="flex items-center gap-3 rounded-md border border-primary/10 bg-[oklch(0.16_0.02_240)] px-3 py-2"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-[11px] font-black text-primary">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-sm font-semibold uppercase tracking-wide">
                  {r.ep?.participant?.name ?? "?"}
                </span>
                <span className="timer-digits text-primary">
                  {formatTime(r.run.official_time_ms)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {drafts.length > 0 && (
          <section>
            <h2 className="mb-2 font-display text-xs font-black uppercase tracking-[0.32em] text-primary/80">
              Final Draft Order
            </h2>
            <ol className="space-y-1.5">
              {drafts.map((d) => {
                const ep = snap.participants.find((p) => p.participant_id === d.participant_id);
                return (
                  <li
                    key={d.selection_order}
                    className="flex items-center gap-3 rounded-md border border-primary/10 bg-[oklch(0.16_0.02_240)] px-3 py-2"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground text-[11px] font-black">
                      {d.draft_position}
                    </span>
                    <span className="flex-1 truncate text-sm font-semibold uppercase tracking-wide">
                      {ep?.participant?.name ?? "?"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
