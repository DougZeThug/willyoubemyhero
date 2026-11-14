import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { setParticipantStatus, resetCombine } from "@/lib/admin-write.functions";
import { addPlayerToRoster, removeParticipantFromEvent } from "@/lib/admin-write.functions";
import { AdminSection } from "@/components/admin-section";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearActiveRun } from "@/lib/active-run";
import { Plus, Trash2, UserPlus, UserMinus, UserCheck, RotateCcw } from "lucide-react";
import { fieldSize } from "@/lib/current-athlete";
import { cn } from "@/lib/utils";
import { useAdminAction } from "@/hooks/use-admin-action";

export function RosterPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const addFn = useServerFn(addPlayerToRoster);
  const removeFn = useServerFn(removeParticipantFromEvent);
  const statusFn = useServerFn(setParticipantStatus);
  const resetFn = useServerFn(resetCombine);
  const { bundle } = useEventBundle();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const add = useAdminAction();
  const reset = useAdminAction();
  const rowAction = useAdminAction();

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    return add.run("Could not add player", async () => {
      // One call, not two: creating the person and putting them on the roster
      // used to be separate, so a failure between them left somebody created and
      // not on the roster — and retyping the name made a second person.
      const res = await addFn({
        data: { eventId, name: trimmed, nickname: nickname.trim() || null },
      });
      await qc.invalidateQueries();
      setName("");
      setNickname("");
      return res.alreadyOnRoster
        ? `${trimmed} is already on the roster`
        : res.created
          ? `Added ${trimmed}`
          : `Added ${trimmed} back to the field`;
    });
  }

  function onRemove(epId: string, playerName: string) {
    if (!confirm(`Remove ${playerName} from this event?`)) return;
    return rowAction.run("Could not remove player", async () => {
      const res = await removeFn({ data: { eventId, eventParticipantId: epId } });
      await qc.invalidateQueries();
      // Deleting a roster row cascades away every copy of that card in the
      // league, so a packed player is scratched instead of deleted.
      return res.retained
        ? `${playerName} marked out — their cards stay in people's collections`
        : `Removed ${playerName}`;
    });
  }

  /** In/out of this year's field. Out keeps the person, their cards and page. */
  function toggleIn(epId: string, playerName: string, isIn: boolean) {
    return rowAction.run("Could not update the roster", async () => {
      await statusFn({
        data: { eventId, eventParticipantId: epId, status: isIn ? "scratched" : "waiting" },
      });
      await qc.invalidateQueries();
      return isIn ? `${playerName} is out` : `${playerName} is in`;
    });
  }

  function onReset() {
    if (
      !confirm(
        "Delete every recorded run for this combine, clear the timer on this phone and set everyone back to waiting?",
      )
    ) {
      return;
    }
    return reset.run("Could not reset the combine", async () => {
      const res = await resetFn({ data: { eventId } });
      // The stored run is what made a reset look like it "didn't take": the
      // server was clean but this phone kept timing the old athlete.
      await clearActiveRun();
      await qc.invalidateQueries();
      return `Combine reset — ${res.clearedRuns} run(s) cleared`;
    });
  }

  const roster = bundle?.participants ?? [];
  const inField = fieldSize(roster);

  return (
    <AdminSection
      icon={<UserPlus className="h-4 w-4 shrink-0" />}
      title="Combine Roster"
      meta={`${inField} in · ${roster.length - inField} out`}
    >
      <form onSubmit={onAdd} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-player-name" className="text-label uppercase tracking-[0.08em]">
              Name
            </Label>
            <Input
              id="new-player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="new-player-nick" className="text-label uppercase tracking-[0.08em]">
              Nickname (optional)
            </Label>
            <Input
              id="new-player-nick"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Nickname"
              maxLength={80}
              autoComplete="off"
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={add.busy || !name.trim()}
          className="min-h-11 w-full sm:min-h-0"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {add.busy ? "Adding…" : "Add to event"}
        </Button>
      </form>

      {roster.length > 0 && (
        <ul className="mt-3 max-h-72 space-y-0.5 overflow-auto pr-1">
          {[...roster]
            .sort((a, b) => a.running_order - b.running_order)
            .map((p) => {
              const isIn = p.participation_status !== "scratched";
              const playerName = p.participant?.name ?? "player";
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1 text-xs"
                >
                  <span
                    className={cn(
                      "truncate uppercase",
                      !isIn && "text-muted-foreground line-through",
                    )}
                  >
                    {playerName}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant={isIn ? "secondary" : "ghost"}
                      className="h-8 px-2 text-label uppercase tracking-[0.08em]"
                      onClick={() => toggleIn(p.id, playerName, isIn)}
                    >
                      {isIn ? (
                        <>
                          <UserCheck className="mr-1 h-3.5 w-3.5" />
                          In
                        </>
                      ) : (
                        <>
                          <UserMinus className="mr-1 h-3.5 w-3.5" />
                          Out
                        </>
                      )}
                    </Button>
                    <button
                      onClick={() => onRemove(p.id, playerName)}
                      className="rounded p-2 text-muted-foreground hover:text-destructive"
                      aria-label={`Drop ${playerName} from the event`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              );
            })}
        </ul>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={reset.busy}
        onClick={onReset}
        className="mt-3 min-h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 sm:min-h-0"
      >
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        {reset.busy ? "Resetting…" : "Reset combine"}
      </Button>
    </AdminSection>
  );
}
