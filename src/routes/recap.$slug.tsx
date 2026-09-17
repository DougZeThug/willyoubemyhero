import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getArchivedRecap } from "@/lib/media.functions";
import { formatTime } from "@/lib/format";
import { standings } from "@/lib/standings";

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
    participation_status?: string;
  }>;
  runs: Array<{
    id: string;
    participant_id: string;
    is_official: boolean;
    official_time_ms: number | null;
    status?: string;
  }>;
  drafts: Array<{ selection_order: number; participant_id: string; draft_position: number }>;
};

function RecapPage() {
  // The loader throws notFound() when there is no row, so this is always present.
  // Typed off the server function because useLoaderData doesn't infer it here.
  const recap = Route.useLoaderData() as NonNullable<Awaited<ReturnType<typeof getArchivedRecap>>>;
  const snap = recap.snapshot as Snapshot;
  // The same standings the live board and the tier rules read, not a third set.
  // Ranking the official *runs* listed anybody re-timed once per attempt and
  // numbered a dead heat 1 and 2 — so this permanent record of an event
  // contradicted the leaderboard the party watched on the night.
  //
  // Both status fields are optional on Snapshot and defaulted here: archiveEvent
  // has always written them, but `snapshot` is untyped jsonb reached through a
  // cast, so the type is an assertion rather than a promise. An empty string is
  // in no status family, which is what a row with nothing recorded should be.
  const rows = standings({
    participants: snap.participants.map((p) => ({
      ...p,
      participation_status: p.participation_status ?? "",
    })),
    runs: snap.runs.map((r) => ({ ...r, status: r.status ?? "" })),
  }).map((s) => ({
    run: s.run,
    place: s.place,
    ep: snap.participants.find((p) => p.participant_id === s.participantId),
  }));
  const drafts = [...snap.drafts].sort((a, b) => a.draft_position - b.draft_position);

  return (
    <div className="circuit-bg min-h-[var(--page-min-h)] px-page-x py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <div className="font-display text-label font-black uppercase tracking-[0.08em] text-primary">
            Recap · Archived {new Date(recap.created_at).toLocaleDateString()}
          </div>
          <h1 className="font-display text-3xl font-black uppercase leading-none">
            {snap.event.name} {snap.event.year ?? ""}
          </h1>
        </header>

        <section>
          <h2 className="mb-2 font-display text-label font-black uppercase tracking-[0.08em] text-primary/80">
            Final Leaderboard
          </h2>
          {/* An ordered list, because it is one. The place is rendered separately
              for the look, so the marker is suppressed — and it comes from
              standings() rather than the render index, which is what lets a dead
              heat share a number. */}
          <ol className="list-none space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.run.id}
                className="flex items-center gap-3 rounded-md border border-primary/10 bg-[oklch(0.16_0.02_240)] px-3 py-2"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-[11px] font-black text-primary">
                  {r.place}
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
            <h2 className="mb-2 font-display text-label font-black uppercase tracking-[0.08em] text-primary/80">
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
