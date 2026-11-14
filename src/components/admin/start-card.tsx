import { useEffect } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Play, Radio } from "lucide-react";
import { awaitingRun, currentAthlete } from "@/lib/current-athlete";
import { cn } from "@/lib/utils";

export function StartCard({
  participants,
  selectedParticipantId,
  onSelect,
  onStart,
  onSetOnClock,
}: {
  participants: NonNullable<ReturnType<typeof useEventBundle>["bundle"]>["participants"];
  selectedParticipantId: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  onSetOnClock: (participantId: string | null) => void;
}) {
  const queued = participants.filter(awaitingRun);
  const slot = currentAthlete(participants);
  const nextUp = queued[0];
  const stillQueued = queued.some((p) => p.participant_id === selectedParticipantId);
  useEffect(() => {
    // Re-selects on a STALE selection, not just an empty one. Scratching the head
    // of the queue is one tap and no confirm, and it leaves that athlete ON the
    // roster — so the old `!selectedParticipantId` guard no-opped, the list below
    // dropped them, and Start Timer went on pointing at somebody this card had
    // stopped showing. Tapping it put them back on the clock and erased the
    // scratch.
    if (stillQueued) return;
    onSelect(nextUp?.participant_id ?? "");
  }, [stillQueued, nextUp?.participant_id, onSelect]);

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <h2 className="mb-3 font-display text-xl font-black uppercase">Send next athlete</h2>
        <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/[0.06] px-3 py-2">
          <Radio
            className={cn(
              "h-4 w-4 shrink-0",
              slot.onClock ? "motion-safe:animate-pulse text-primary" : "text-muted-foreground",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-label uppercase tracking-[0.08em] text-muted-foreground">
              {slot.onClock ? "On the clock" : "Up next on the crowd screens"}
            </div>
            <div className="truncate text-sm font-semibold uppercase">
              {slot.athlete?.participant?.name ?? "Nobody left"}
            </div>
          </div>
          {slot.onClock ? (
            <Button size="sm" variant="ghost" onClick={() => onSetOnClock(null)}>
              Clear
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedParticipantId}
              onClick={() => onSetOnClock(selectedParticipantId)}
            >
              On the clock
            </Button>
          )}
        </div>
        <div className="max-h-[55dvh] overflow-auto rounded border border-white/5 divide-y divide-white/5 sm:max-h-72">
          {queued.map((p) => {
            const sel = p.participant_id === selectedParticipantId;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.participant_id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition",
                  sel ? "bg-primary/15" : "hover:bg-white/5",
                )}
              >
                <span className="grid h-7 w-7 place-items-center rounded-md bg-white/5 font-display text-sm font-black tabular">
                  {p.running_order}
                </span>
                <ParticipantAvatar
                  name={p.participant?.name ?? "?"}
                  photoUrl={p.participant?.profile_image_url ?? null}
                  size={32}
                />
                <span className="flex-1 truncate font-semibold uppercase">
                  {p.participant?.name}
                </span>
                {sel && <Badge className="bg-primary text-primary-foreground">Next</Badge>}
              </button>
            );
          })}
          {queued.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No athletes left in the queue.
            </div>
          )}
        </div>
        {/* Wrapped, not passed by reference: startRun now reads its first
            argument as the athlete to start, and a bare reference would hand it
            React's click event. This card seeds the selection above instead, so
            it has nothing to pass. */}
        <Button
          className="mt-4 w-full"
          size="lg"
          disabled={!selectedParticipantId}
          onClick={() => onStart()}
        >
          <Play className="mr-2 h-5 w-5" />
          Start Timer
        </Button>
      </CardContent>
    </Card>
  );
}
