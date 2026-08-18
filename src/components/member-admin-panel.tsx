import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Lock, Unlock, Trophy, RefreshCw } from "lucide-react";
import { generateMemberCodes, listMemberClaims } from "@/lib/member.functions";
import { closeAwardVoting, getAwardTally, reopenAwardVoting } from "@/lib/social.functions";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { AWARD_CATEGORIES } from "@/lib/awards";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";

type Issued = { participantId: string; name: string; code: string };

/** Member codes: issue, see who has claimed, copy the whole list out. */
export function MemberCodesPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const generateFn = useServerFn(generateMemberCodes);
  const claimsFn = useServerFn(listMemberClaims);
  const { bundle } = useEventBundle();
  const [issued, setIssued] = useState<Issued[] | null>(null);
  // Codes issued for a single player stay pinned next to their row, so the
  // commissioner can re-issue for one straggler without losing the roster view.
  const [singles, setSingles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const claims = useQuery({
    queryKey: ["member-claims", eventId],
    queryFn: () => claimsFn({ data: { eventId } }),
    staleTime: 30_000,
  });

  const claimedCount = (claims.data ?? []).filter((c) => c.claimed_at).length;
  const rosterSize = bundle?.participants.length ?? 0;
  const unclaimedCount = Math.max(rosterSize - claimedCount, 0);

  async function issue(scope: "all" | "unclaimed") {
    setBusy(true);
    try {
      const res = await generateFn({ data: { eventId, scope } });
      setIssued(res.issued);
      await qc.invalidateQueries({ queryKey: ["member-claims", eventId] });
      toast.success(`Issued ${res.issued.length} codes — copy them now`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate codes");
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateUnclaimed() {
    if (unclaimedCount === 0) {
      toast.info("Everyone has claimed — nothing to issue");
      return;
    }
    if (
      !confirm(
        `Issue a new code for the ${unclaimedCount} player${unclaimedCount === 1 ? "" : "s"} who ` +
          "haven't claimed yet? Players who already claimed keep their current code.",
      )
    ) {
      return;
    }
    await issue("unclaimed");
  }

  async function onReissueAll() {
    if (
      !confirm(
        "Issue a NEW code for every player? Any code you already handed out stops working. " +
          "Already-claimed devices stay signed in until their token expires.",
      )
    ) {
      return;
    }
    await issue("all");
  }

  async function copyAll() {
    if (!issued) return;
    const text = issued.map((i) => `${i.name}: ${i.code}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard blocked — select and copy manually");
    }
  }

  async function issueOne(participantId: string, name: string) {
    if (
      !confirm(
        `Issue a NEW code for ${name}? Only their code changes — everyone else keeps theirs.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await generateFn({ data: { eventId, participantIds: [participantId] } });
      const code = res.issued[0]?.code;
      if (!code) throw new Error("No code returned");
      setSingles((s) => ({ ...s, [participantId]: code }));
      await qc.invalidateQueries({ queryKey: ["member-claims", eventId] });
      toast.success(`New code for ${name} — copy it now`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate code");
    } finally {
      setBusy(false);
    }
  }

  async function copyAllUnused() {
    if (!issued) return;
    const text = issued.map((i) => `${i.name}: ${i.code}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard blocked — select and copy manually");
    }
  }

  return (
    <AdminSection
      icon={<KeyRound className="h-4 w-4 shrink-0" />}
      title="Member Codes"
      meta={`${claimedCount}/${rosterSize} claimed`}
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Each player claims their name once with a code, which lets them react, talk trash, and vote.
        Codes are stored hashed — the plaintext is shown here once and never again.
      </p>

      <div className="space-y-2">
        <Button
          size="sm"
          onClick={onGenerateUnclaimed}
          disabled={busy}
          className="min-h-11 w-full sm:min-h-0"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Issuing…" : `Issue codes for unclaimed (${unclaimedCount})`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReissueAll}
          disabled={busy}
          className="min-h-11 w-full border-warn/40 text-warn hover:bg-warn/10 sm:min-h-0"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Re-issue ALL codes
        </Button>
      </div>

      {issued && (
        <div className="mt-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-warn">
              Copy these now
            </span>
            <button
              onClick={copyAll}
              className="inline-flex min-h-9 items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-widest text-primary hover:underline sm:min-h-0 sm:px-0"
            >
              <Copy className="h-3 w-3" /> Copy all
            </button>
          </div>
          <ul className="max-h-[50vh] space-y-0.5 overflow-auto rounded-md border border-warn/30 bg-warn/5 p-2 sm:max-h-56">
            {issued.map((i) => (
              <li key={i.participantId} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate uppercase">{i.name}</span>
                <code className="shrink-0 font-mono font-bold tracking-[0.2em] text-warn">
                  {i.code}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!issued && (claims.data?.length ?? 0) > 0 && (
        <ul className="mt-3 max-h-[50vh] space-y-0.5 overflow-auto pr-1 sm:max-h-40">
          {(bundle?.participants ?? []).map((p) => {
            const claim = claims.data?.find((c) => c.participant_id === p.participant_id);
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs"
              >
                <span className="truncate uppercase">{p.participant?.name}</span>
                <span
                  className={
                    claim?.claimed_at
                      ? "shrink-0 text-[10px] uppercase tracking-widest text-primary"
                      : "shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground"
                  }
                >
                  {claim?.claimed_at ? "claimed" : claim ? "code issued" : "no code"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}

/** Live tally (commissioner only) plus the close/reopen switch. */
export function AwardsAdminPanel({ eventId, locked }: { eventId: string; locked: boolean }) {
  const qc = useQueryClient();
  const { bundle } = useEventBundle();
  const tallyFn = useServerFn(getAwardTally);
  const closeFn = useServerFn(closeAwardVoting);
  const reopenFn = useServerFn(reopenAwardVoting);
  const [busy, setBusy] = useState(false);

  const tally = useQuery({
    queryKey: ["award-tally", eventId],
    queryFn: () => tallyFn({ data: { eventId } }),
    staleTime: 15_000,
  });

  const nameOf = useMemo(() => {
    const map = new Map(
      (bundle?.participants ?? []).map((p) => [p.participant_id, p.participant?.name ?? "—"]),
    );
    return (id: string) => map.get(id) ?? "—";
  }, [bundle]);

  async function onClose() {
    if (!confirm("Close voting and publish winners? Ties are published as joint winners.")) return;
    setBusy(true);
    try {
      const res = await closeFn({ data: { eventId } });
      await qc.invalidateQueries();
      toast.success(`Published ${res.published} award${res.published === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close voting");
    } finally {
      setBusy(false);
    }
  }

  async function onReopen() {
    if (!confirm("Reopen voting? This removes the published winners.")) return;
    setBusy(true);
    try {
      await reopenFn({ data: { eventId } });
      await qc.invalidateQueries();
      toast.success("Voting reopened");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reopen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSection
      icon={<Trophy className="h-4 w-4 shrink-0" />}
      title="League Awards"
      meta={`${tally.data?.totalVotes ?? 0} votes`}
    >
      <p className="mb-3 text-xs text-muted-foreground">
        {locked
          ? "Voting is closed and winners are published on player cards."
          : "Only you can see this tally. Members see nothing until you close voting."}
      </p>

      <div className="max-h-[50vh] space-y-2 overflow-auto pr-1 sm:max-h-56">
        {AWARD_CATEGORIES.map((cat) => {
          const counts = tally.data?.tally?.[cat.id] ?? {};
          const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          return (
            <div key={cat.id}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-primary/80">
                {cat.icon} {cat.label}
              </div>
              {ranked.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">No votes</div>
              ) : (
                <ul className="text-[11px]">
                  {ranked.slice(0, 3).map(([pid, n]) => (
                    <li key={pid} className="flex justify-between gap-2">
                      <span className="truncate uppercase">{nameOf(pid)}</span>
                      <span className="tabular text-muted-foreground">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        {locked ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onReopen}
            disabled={busy}
            className="min-h-11 w-full sm:min-h-0"
          >
            <Unlock className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Working…" : "Reopen voting"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 w-full sm:min-h-0"
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Working…" : "Close voting & publish"}
          </Button>
        )}
      </div>
    </AdminSection>
  );
}
