import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, IdCard } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { formatTime } from "@/lib/format";

export const Route = createFileRoute("/players/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Player Card · ${params.id.slice(0, 8)} — Draft Combine` },
      { name: "description", content: "Full player card for the Will YOU Be My Hero? draft combine." },
      { property: "og:title", content: "Draft Combine — Player Card" },
      { property: "og:description", content: "Full player trading card." },
    ],
  }),
  component: PlayerCardPage,
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">
      Player not found.{" "}
      <Link to="/players" className="text-primary underline">Back to roster</Link>
    </div>
  ),
});

function PlayerCardPage() {
  const { id } = Route.useParams();
  const { event, bundle, loading } = useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);

  if (loading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const ep = bundle?.participants.find((p) => p.id === id);
  if (!ep) throw notFound();

  const cardUrl = cards.data?.[ep.id] ?? null;
  const photoUrl = photos.data?.[ep.id] ?? ep.participant?.profile_image_url ?? null;
  const officialRun = (bundle?.runs ?? [])
    .filter((r) => r.is_official && r.participant_id === ep.participant_id)
    .sort((a, b) => (a.official_time_ms ?? 0) - (b.official_time_ms ?? 0))[0];

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/players"
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.3em] text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Roster
          </Link>
          <div className="flex items-center gap-2 text-primary">
            <IdCard className="h-4 w-4" />
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">
              Player Card
            </span>
          </div>
        </div>

        {cardUrl ? (
          <div className="flex justify-center">
            <img
              src={cardUrl}
              alt={`${ep.participant?.name ?? "Player"} card`}
              className="hud-glow max-h-[85vh] w-auto max-w-full rounded-xl border border-primary/30 shadow-2xl"
            />
          </div>
        ) : (
          <Card className="hud-bezel border-white/10">
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <ParticipantAvatar
                name={ep.participant?.name ?? "?"}
                photoUrl={photoUrl}
                size={200}
              />
              <div>
                <div className="font-display text-3xl font-black uppercase tracking-wide">
                  {ep.participant?.name ?? "—"}
                </div>
                {ep.participant?.fantasy_team_name && (
                  <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                    {ep.participant.fantasy_team_name}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4 pt-2">
                <Stat label="Order" value={`#${ep.running_order}`} />
                <Stat
                  label="Time"
                  value={officialRun ? formatTime(officialRun.official_time_ms) : "—"}
                  mono
                />
                <Stat
                  label="Pick"
                  value={ep.selected_draft_position != null ? `#${ep.selected_draft_position}` : "—"}
                />
              </div>
              <p className="max-w-xs text-xs text-muted-foreground">
                No card image uploaded yet. Admins can upload a card from the Admin console.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="hud-bezel rounded-md border border-white/10 px-4 py-2 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
      <div className={"font-display text-xl font-black text-primary " + (mono ? "timer-digits tabular" : "")}>
        {value}
      </div>
    </div>
  );
}