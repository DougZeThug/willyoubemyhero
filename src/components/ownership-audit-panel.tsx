import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SearchCheck } from "lucide-react";
import { attachDeviceToPlayer, getOwnershipAudit } from "@/lib/ownership-audit.functions";
import type { OwnershipAudit } from "@/lib/ownership-audit.functions";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";

/**
 * "Why can't I see my card in trades?", answered.
 *
 * Two failure modes, both invisible from every other screen: cards filed against
 * a DEVICE rather than a player (a pack opened before they claimed anything), and
 * players nobody can send an offer to because they never claimed a code or picked
 * a name. Both show here, and the first is repairable in one tap.
 */
export function OwnershipAuditPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const auditFn = useServerFn(getOwnershipAudit);
  const attachFn = useServerFn(attachDeviceToPlayer);
  const [busy, setBusy] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const audit = useQuery({
    queryKey: ["ownership-audit", eventId],
    queryFn: () => auditFn({ data: { eventId } }) as Promise<OwnershipAudit>,
    staleTime: 30_000,
  });

  const players = audit.data?.players ?? [];
  const stranded = audit.data?.stranded ?? [];
  const unreachable = useMemo(() => players.filter((p) => !p.reachable), [players]);

  async function attach(guestId: string) {
    const participantId = targets[guestId];
    if (!participantId) {
      toast.error("Pick who this device belongs to");
      return;
    }
    const name = players.find((p) => p.participantId === participantId)?.name ?? "that player";
    if (!confirm(`Move this device's cards onto ${name}? This can't be undone.`)) return;
    setBusy(guestId);
    try {
      const res = await attachFn({ data: { eventId, guestId, participantId } });
      toast.success(`${res.name} now holds ${res.secrets} secret${res.secrets === 1 ? "" : "s"}`);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move those cards");
    } finally {
      setBusy(null);
    }
  }

  const selectClass =
    "min-h-9 w-full rounded-md border border-primary/30 bg-background px-2 text-[11px] uppercase tracking-widest text-foreground";

  return (
    <AdminSection icon={<SearchCheck className="h-4 w-4 shrink-0" />} title="Card Ownership Audit">
      <p className="mb-3 text-xs text-muted-foreground">
        Cards filed against a phone instead of a person still show in that phone&apos;s vault, but
        nobody can trade for them. Attach a device to whoever was holding it and the cards move
        across for good.
      </p>

      {audit.isPending ? (
        <p className="text-xs text-muted-foreground">Counting collections…</p>
      ) : (
        <>
          <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
            Loose devices ({stranded.length})
          </h3>
          {stranded.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every card in the league belongs to a player.
            </p>
          ) : (
            <ul className="space-y-2">
              {stranded.map((d) => (
                <li key={d.guestId} className="rounded-md border border-white/10 p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {d.guestId.slice(0, 8)}…
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-foreground">
                      {d.secrets} secret{d.secrets === 1 ? "" : "s"} · {d.packOpens} pack
                      {d.packOpens === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {d.signedIn ? "Signed-in account, no name picked · " : ""}
                    {d.firstSeen ?? "—"} → {d.lastSeen ?? "—"}
                    {d.sample.length > 0 && ` · ${d.sample.join(", ")}`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <select
                      className={selectClass}
                      value={targets[d.guestId] ?? ""}
                      onChange={(e) =>
                        setTargets((t) => ({ ...t, [d.guestId]: e.target.value }))
                      }
                    >
                      <option value="">Belongs to…</option>
                      {players.map((p) => (
                        <option key={p.participantId} value={p.participantId}>
                          {p.name}
                          {p.isCollector ? " (collector)" : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={() => attach(d.guestId)}
                      disabled={busy === d.guestId}
                    >
                      {busy === d.guestId ? "Moving…" : "Attach"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {unreachable.length > 0 && (
            <>
              <h3 className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-[0.25em] text-warn">
                Can&apos;t receive offers ({unreachable.length})
              </h3>
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                No claimed code and no account — they never appear as a trade partner.
              </p>
              <p className="text-[11px] text-foreground">
                {unreachable.map((p) => p.name).join(" · ")}
              </p>
            </>
          )}

          <h3 className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
            Who holds what
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-bold uppercase tracking-widest">Player</th>
                  <th className="py-1 pr-2 font-bold uppercase tracking-widest">Cards</th>
                  <th className="py-1 pr-2 font-bold uppercase tracking-widest">Secrets</th>
                  <th className="py-1 font-bold uppercase tracking-widest">Tradeable</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.participantId} className="border-t border-white/5">
                    <td className="py-1 pr-2">
                      {p.name}
                      {!p.reachable && <span className="text-warn"> ⚠</span>}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{p.rosterCopies}</td>
                    <td className="py-1 pr-2 tabular-nums">{p.secrets}</td>
                    <td className="py-1 tabular-nums text-muted-foreground">
                      {p.tradeableRoster} + {p.tradeableSecrets}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminSection>
  );
}
