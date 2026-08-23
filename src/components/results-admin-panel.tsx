/**
 * The commissioner's book of results.
 *
 * Timing happens on Live; this is where a day's results get fixed afterwards.
 * Every athlete on the roster is listed in running order with their official
 * time, so the two failure modes of a combine run on phones — a time that is
 * wrong and a time that never saved at all — both have a way out: edit the
 * result, or type one in for somebody the clock missed.
 */
import { useMemo, useState } from "react";
import { ListOrdered, Pencil, Plus } from "lucide-react";
import { AdminSection } from "@/components/admin-section";
import { EditResultSheet } from "@/components/edit-result-sheet";
import { Button } from "@/components/ui/button";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { formatTime } from "@/lib/format";

export function ResultsAdminPanel({ eventId }: { eventId: string }) {
  const { bundle } = useEventBundle();
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => {
    const runs = bundle?.runs ?? [];
    return (bundle?.participants ?? [])
      .filter((p) => p.participation_status !== "scratched")
      .map((p) => {
        const mine = runs.filter((r) => r.participant_id === p.participant_id);
        const run = mine.find((r) => r.is_official) ?? mine[mine.length - 1] ?? null;
        return {
          id: p.id,
          participantId: p.participant_id,
          order: p.running_order,
          name: p.participant?.name ?? "—",
          officialMs: run?.official_time_ms ?? null,
          attempts: mine.length,
        };
      });
  }, [bundle?.participants, bundle?.runs]);

  const timed = rows.filter((r) => r.officialMs != null).length;
  const editingRow = rows.find((r) => r.participantId === editing) ?? null;

  return (
    <AdminSection
      icon={<ListOrdered className="h-4 w-4 shrink-0" />}
      title="Results"
      meta={`${timed}/${rows.length} timed`}
    >
      <ul className="divide-y divide-white/5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5 font-display text-xs font-black tabular">
              {r.order}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold uppercase">
              {r.name}
              {r.attempts > 1 && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({r.attempts} attempts)
                </span>
              )}
            </span>
            <span className="timer-digits tabular shrink-0 text-sm text-primary">
              {r.officialMs == null ? "—" : formatTime(r.officialMs)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2 text-[10px] uppercase tracking-widest"
              onClick={() => setEditing(r.participantId)}
            >
              {r.officialMs == null ? (
                <>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add time
                </>
              ) : (
                <>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </>
              )}
            </Button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="py-3 text-sm text-muted-foreground">Nobody on the roster yet.</li>
        )}
      </ul>

      {editingRow && (
        <EditResultSheet
          eventId={eventId}
          participantId={editingRow.participantId}
          participantName={editingRow.name}
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </AdminSection>
  );
}
