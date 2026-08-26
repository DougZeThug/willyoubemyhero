import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, RefreshCw, SearchCheck } from "lucide-react";
import { attachDeviceToPlayer, getOwnershipAudit } from "@/lib/ownership-audit.functions";
import type { OwnershipAudit, OwnershipRow } from "@/lib/ownership-audit.functions";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Why can't I see my card in trades?", answered.
 *
 * Two failure modes, both invisible from every other screen: cards filed against
 * a DEVICE rather than a player (a pack opened before they claimed anything), and
 * players nobody can send an offer to because they never claimed a code or picked
 * a name. Both show here, and the first is repairable in one tap.
 *
 * On a phone all three lists at once is a wall of scroll, so they live behind a
 * segmented control and the attach controls stay folded until a device is tapped.
 */

type Tab = "devices" | "unreachable" | "holdings";

export function OwnershipAuditPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const auditFn = useServerFn(getOwnershipAudit);
  const attachFn = useServerFn(attachDeviceToPlayer);
  const [busy, setBusy] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [openDevice, setOpenDevice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("devices");
  const [showEmpty, setShowEmpty] = useState(false);

  const audit = useQuery({
    queryKey: ["ownership-audit", eventId],
    queryFn: () => auditFn({ data: { eventId } }) as Promise<OwnershipAudit>,
    staleTime: 30_000,
  });

  const players = useMemo(() => audit.data?.players ?? [], [audit.data?.players]);
  const stranded = audit.data?.stranded ?? [];
  const unreachable = players.filter((p) => !p.reachable);
  const holders = players.filter((p) => p.rosterCopies > 0 || p.secrets > 0);
  const empties = players.filter((p) => p.rosterCopies === 0 && p.secrets === 0);

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
      setOpenDevice(null);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move those cards");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "devices", label: "Loose", count: stranded.length },
    { id: "unreachable", label: "Can't trade", count: unreachable.length },
    { id: "holdings", label: "Holdings", count: holders.length },
  ];

  return (
    <AdminSection
      icon={<SearchCheck className="h-4 w-4 shrink-0" />}
      title="Card Ownership Audit"
      meta={stranded.length > 0 ? `${stranded.length} loose` : "all filed"}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-lg border border-primary/20 bg-black/40 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "min-h-9 truncate rounded-md px-1.5 text-xs font-bold uppercase tracking-wider transition-colors",
                tab === t.id
                  ? "bg-primary/20 text-primary shadow-inner"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="ml-1 tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 shrink-0 px-2"
          aria-label="Refresh audit"
          onClick={() => audit.refetch()}
          disabled={audit.isFetching}
        >
          <RefreshCw className={cn("h-4 w-4", audit.isFetching && "animate-spin")} />
        </Button>
      </div>

      {audit.isPending ? (
        <p className="text-xs text-muted-foreground">Counting collections…</p>
      ) : tab === "devices" ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Cards filed against a phone still show in that phone&apos;s vault, but nobody can trade
            for them. Tap a device, pick who was holding it, and the cards move across for good.
          </p>
          {stranded.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every card in the league belongs to a player.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {stranded.map((d) => {
                const open = openDevice === d.guestId;
                return (
                  <li key={d.guestId}>
                    <button
                      type="button"
                      onClick={() => setOpenDevice(open ? null : d.guestId)}
                      className="flex min-h-11 w-full items-center gap-2 py-2 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs text-foreground">
                          {d.guestId.slice(0, 8)}…
                          {d.signedIn && (
                            <span className="ml-1.5 text-[11px] uppercase tracking-wider text-warn">
                              account
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {d.firstSeen ?? "—"} → {d.lastSeen ?? "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs font-bold uppercase tracking-wider text-primary">
                        {d.secrets} secret{d.secrets === 1 ? "" : "s"}
                        <span className="block text-[11px] font-semibold text-muted-foreground">
                          {d.packOpens} pack{d.packOpens === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "h-4 w-4 shrink-0 text-primary/70 transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    </button>

                    {open && (
                      <div className="pb-3">
                        {d.sample.length > 0 && (
                          <p className="mb-2 text-xs text-muted-foreground">
                            Holding: {d.sample.join(", ")}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <select
                            className="min-h-10 w-full min-w-0 rounded-md border border-primary/30 bg-background px-2 text-xs uppercase tracking-wider text-foreground"
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
                            className="h-10 shrink-0"
                            onClick={() => attach(d.guestId)}
                            disabled={busy === d.guestId}
                          >
                            {busy === d.guestId ? "Moving…" : "Attach"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : tab === "unreachable" ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            No claimed code and no account — they never appear as a trade partner.
          </p>
          {unreachable.length === 0 ? (
            <p className="text-xs text-muted-foreground">Everyone can receive an offer.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {unreachable.map((p) => (
                <li
                  key={p.participantId}
                  className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs font-semibold text-foreground"
                >
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <ul className="divide-y divide-white/5">
            {holders.map((p) => (
              <HolderRow key={p.participantId} p={p} />
            ))}
            {holders.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">Nobody holds a card yet.</li>
            )}
          </ul>

          {empties.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowEmpty((v) => !v)}
                className="mt-3 flex min-h-10 w-full items-center justify-between gap-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                No cards yet ({empties.length})
                <ChevronDown
                  aria-hidden
                  className={cn("h-4 w-4 transition-transform", showEmpty && "rotate-180")}
                />
              </button>
              {showEmpty && (
                <ul className="flex flex-wrap gap-1.5 pb-1">
                  {empties.map((p) => (
                    <li
                      key={p.participantId}
                      className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {p.name}
                      {!p.reachable && <span className="text-warn"> ⚠</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </AdminSection>
  );
}

/** Name on the left, three labelled stat pills on the right — survives 360px. */
function HolderRow({ p }: { p: OwnershipRow }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2">
      <span className="min-w-0 truncate text-xs font-semibold text-foreground">
        {p.name}
        {p.isCollector && (
          <span className="ml-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            collector
          </span>
        )}
        {!p.reachable && <span className="text-warn"> ⚠</span>}
      </span>
      <span className="flex shrink-0 gap-1.5">
        <Stat label="Cards" value={p.rosterCopies} />
        <Stat label="Secret" value={p.secrets} />
        <Stat label="Trade" value={`${p.tradeableRoster}+${p.tradeableSecrets}`} muted />
      </span>
    </li>
  );
}

function Stat({ label, value, muted }: { label: string; value: number | string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "min-w-11 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-center",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <span className="block text-xs font-bold tabular-nums leading-tight">{value}</span>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </span>
  );
}
