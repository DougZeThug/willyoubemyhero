import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { ParticipantAvatar } from "@/components/participant-avatar";

export const Route = createFileRoute("/players")({
  head: () => ({
    meta: [
      { title: "Players — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Browse every combine athlete and open their full player card." },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Players" },
      { property: "og:description", content: "Every athlete, every card." },
    ],
  }),
  component: PlayersPage,
});

function PlayersPage() {
  const { event, bundle } = useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  const rows = [...(bundle?.participants ?? [])].sort((a, b) =>
    (a.participant?.name ?? "").localeCompare(b.participant?.name ?? ""),
  );

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <Users className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              Roster
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">Players</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Tap a player to view their full trading card.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {rows.map((p) => {
            const hasCard = !!cards.data?.[p.id];
            return (
              <Link
                key={p.id}
                to="/players/$id"
                params={{ id: p.id }}
                className="group hud-bezel flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-[oklch(0.16_0.02_240)] p-3 transition hover:border-primary/60 hover:hud-glow"
              >
                <ParticipantAvatar
                  name={p.participant?.name ?? "?"}
                  photoUrl={photos.data?.[p.id] ?? p.participant?.profile_image_url ?? null}
                  size={112}
                />
                <div className="w-full text-center">
                  <div className="truncate font-display text-sm font-black uppercase tracking-wide text-foreground group-hover:text-primary">
                    {p.participant?.name ?? "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {hasCard ? "View Card" : "No card yet"}
                  </div>
                </div>
              </Link>
            );
          })}
          {rows.length === 0 && (
            <div className="col-span-full p-8 text-center text-sm text-muted-foreground">
              No participants yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}