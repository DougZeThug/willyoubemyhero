import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { getAdminStatus } from "@/lib/admin.functions";
import { recordDraftSelection, undoLastDraftSelection } from "@/lib/admin-write.functions";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { ClipboardList, Undo2 } from "lucide-react";

export const Route = createFileRoute("/draft")({
  head: () => ({
    meta: [
      { title: "Draft Order — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Live draft pick selection based on combine results." },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Draft" },
      { property: "og:description", content: "Combine winners select their fantasy draft positions live." },
    ],
  }),
  component: DraftPage,
});

function DraftPage() {
  const { event, bundle } = useEventBundle();
  const adminStatusFn = useServerFn(getAdminStatus);
  const recordFn = useServerFn(recordDraftSelection);
  const undoFn = useServerFn(undoLastDraftSelection);
  const [busy, setBusy] = useState(false);

  const admin = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => adminStatusFn(),
    staleTime: 30_000,
  });
  const isAdmin = !!event?.id && admin.data?.eventId === event.id;

  const { rankings, taken, currentPicker } = useMemo(() => {
    const parts = bundle?.participants ?? [];
    const runs = bundle?.runs ?? [];
    const ranking = runs
      .filter((r) => r.is_official)
      .map((r) => {
        const ep = parts.find((p) => p.participant_id === r.participant_id);
        return { run: r, ep };
      })
      .sort((a, b) => (a.run.official_time_ms ?? Infinity) - (b.run.official_time_ms ?? Infinity));
    const takenSet = new Set(
      parts.filter((p) => p.selected_draft_position != null).map((p) => p.selected_draft_position!),
    );
    const currentPicker = ranking.find((row) => row.ep?.selected_draft_position == null) ?? null;
    return { rankings: ranking, taken: takenSet, currentPicker };
  }, [bundle]);

  const totalPositions = bundle?.participants.length ?? 0;

  async function pick(pos: number) {
    if (!currentPicker || !event?.id) return;
    setBusy(true);
    try {
      await recordFn({
        data: {
          eventId: event.id,
          participantId: currentPicker.ep!.participant_id,
          draftPosition: pos,
        },
      });
      toast.success(`${currentPicker.ep!.participant?.name} picks #${pos}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!event?.id) return;
    setBusy(true);
    try {
      await undoFn({ data: { eventId: event.id } });
      toast.success("Undid last pick");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-black uppercase">Draft Board</h1>
        </div>
        {isAdmin && (
          <Button onClick={undo} disabled={busy} size="sm" variant="secondary">
            <Undo2 className="mr-1.5 h-4 w-4" />
            Undo last
          </Button>
        )}
      </div>

      {currentPicker ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex items-center gap-4 p-5">
            <ParticipantAvatar
              name={currentPicker.ep!.participant?.name ?? "?"}
              photoUrl={currentPicker.ep!.participant?.profile_image_url ?? null}
              size={72}
            />
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-[0.3em] text-primary">
                On the clock
              </div>
              <div className="font-display text-3xl font-black uppercase">
                {currentPicker.ep!.participant?.name}
              </div>
              <div className="text-xs text-muted-foreground">
                Combine time {formatTime(currentPicker.run.official_time_ms)}
                {isAdmin ? " · Tap a position below to lock the pick" : ""}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {rankings.length === 0
              ? "No combine results yet. Draft board opens once athletes finish."
              : "All picks are in. Congrats on a clean draft."}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wider text-muted-foreground">
          Positions
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {Array.from({ length: totalPositions }, (_, i) => i + 1).map((pos) => {
            const holder = bundle?.participants.find((p) => p.selected_draft_position === pos);
            const isTaken = taken.has(pos);
            return (
              <button
                key={pos}
                onClick={() => isAdmin && !isTaken && currentPicker && pick(pos)}
                disabled={isTaken || !isAdmin || !currentPicker || busy}
                className={
                  "aspect-square rounded-lg border p-2 text-left transition " +
                  (isTaken
                    ? "border-primary/30 bg-primary/10"
                    : isAdmin && currentPicker
                      ? "border-white/10 bg-white/5 hover:border-primary hover:bg-primary/10"
                      : "border-white/5 bg-white/5 opacity-70")
                }
              >
                <div className="font-display text-3xl font-black tabular leading-none text-foreground">
                  {pos}
                </div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {holder?.participant?.name ?? (isTaken ? "" : "Open")}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}