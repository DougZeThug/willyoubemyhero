import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls } from "@/hooks/use-photo-urls";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListOrdered, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminSession } from "@/lib/admin-token";
import { recordRandomization, setRunningOrder } from "@/lib/admin-write.functions";
import { newSeed, seededRng, shuffle } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/order")({
  head: () => ({
    meta: [
      { title: "Running Order — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Randomized athlete order for the combine." },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Order" },
      { property: "og:description", content: "Who's up when." },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { event, bundle } = useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const setOrderFn = useServerFn(setRunningOrder);
  const recordFn = useServerFn(recordRandomization);
  const [busy, setBusy] = useState(false);

  const admin = useAdminSession();
  const isAdmin = !!event?.id && admin?.eventId === event.id;

  const rows = useMemo(
    () => [...(bundle?.participants ?? [])].sort((a, b) => a.running_order - b.running_order),
    [bundle],
  );

  async function reshuffle() {
    if (!event?.id) return;
    setBusy(true);
    try {
      const seed = newSeed();
      const rng = seededRng(seed);
      const shuffled = shuffle(rows, rng);
      const orderPayload = shuffled.map((r, i) => ({ id: r.id, running_order: i + 1 }));
      await setOrderFn({ data: { eventId: event.id, order: orderPayload } });
      await recordFn({
        data: {
          eventId: event.id,
          scope: "all",
          previous: rows.map((r) => ({ id: r.id, running_order: r.running_order })),
          resulting: orderPayload,
          seed,
        },
      });
      toast.success("Running order re-randomized");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to shuffle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-2 border-b border-primary/20 pb-4">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <ListOrdered className="h-5 w-5" />
              <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">Order</span>
            </div>
            <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">Running Order</h1>
          </div>
          {isAdmin && !event?.running_order_locked && (
            <Button onClick={reshuffle} disabled={busy} size="sm">
              <Shuffle className="mr-1.5 h-4 w-4" />
              {busy ? "Shuffling…" : "Re-randomize"}
            </Button>
          )}
        </div>

      <Card className="hud-bezel border-white/10">
        <CardContent className="p-0">
          <ol className="divide-y divide-white/5">
            {rows.map((r) => {
              const status = r.participation_status ?? "queued";
              const accent =
                status === "running"
                  ? "shadow-[inset_3px_0_0_0_var(--color-primary)] bg-primary/[0.06]"
                  : "";
              return (
              <li key={r.id} className={cn("flex items-center gap-3 px-4 py-3 transition", accent)}>
                <span className="hud-bezel grid h-8 w-8 shrink-0 place-items-center rounded-md font-display text-lg font-black tabular text-primary">
                  {r.running_order}
                </span>
                <ParticipantAvatar
                  name={r.participant?.name ?? "?"}
                  photoUrl={photos.data?.[r.id] ?? r.participant?.profile_image_url ?? null}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/players/$id"
                    params={{ id: r.id }}
                    className="block truncate font-display text-lg font-bold uppercase leading-tight hover:text-primary"
                  >
                    {r.participant?.name ?? "—"}
                  </Link>
                  {r.participant?.fantasy_team_name && (
                    <div className="truncate text-xs text-muted-foreground">
                      {r.participant.fantasy_team_name}
                    </div>
                  )}
                </div>
                <StatusBadge status={status} />
              </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-primary text-primary-foreground"
      : status === "finished"
        ? "bg-primary/15 text-primary"
        : status === "scratched"
          ? "bg-destructive/20 text-destructive"
          : "bg-white/10 text-muted-foreground";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}