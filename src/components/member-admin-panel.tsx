import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Lock, Unlock, Trophy, RefreshCw } from "lucide-react";
import { generateMemberCodes, listMemberClaims } from "@/lib/member.functions";
import { closeAwardVoting, getAwardTally, reopenAwardVoting } from "@/lib/social.functions";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { AWARD_CATEGORIES } from "@/lib/awards";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Issued = { participantId: string; name: string; code: string };

/** Member codes: issue, see who has claimed, copy the whole list out. */
export function MemberCodesPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const generateFn = useServerFn(generateMemberCodes);
  const claimsFn = useServerFn(listMemberClaims);
  const { bundle } = useEventBundle();
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [busy, setBusy] = useState(false);

  const claims = useQuery({
    queryKey: ["member-claims", eventId],
    queryFn: () => claimsFn({ data: { eventId } }),
    staleTime: 30_000,
  });

  const claimedCount = (claims.data ?? []).filter((c) => c.claimed_at).length;
  const rosterSize = bundle?.participants.length ?? 0;

  async function onGenerate() {
    if (
      !confirm(
        "Issue a NEW code for every player? Any code you already handed out stops working. " +
          "Already-claimed devices stay signed in until their token expires.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await generateFn({ data: { eventId } });
      setIssued(res.issued);
      await qc.invalidateQueries({ queryKey: ["member-claims", eventId] });
      toast.success(`Issued ${res.issued.length} codes — copy them now`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate codes");
    } finally {
      setBusy(false);
    }
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

  return (
    <Card className="hud-bezel border-primary/20">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-primary">
            <KeyRound className="h-4 w-4" />
            <h2 className="font-display text-sm font-black uppercase tracking-[0.3em]">
              Member Codes
            </h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {claimedCount}/{rosterSize} claimed
          </span>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          Each player claims their name once with a code, which lets them react, talk trash, and
          vote. Codes are stored hashed — the plaintext is shown here once and never again.
        </p>

        <Button size="sm" onClick={onGenerate} disabled={busy} className="w-full">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Issuing…" : issued ? "Re-issue all codes" : "Generate codes"}
        </Button>

        {issued && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-warn">
                Copy these now
              </span>
              <button
                onClick={copyAll}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
              >
                <Copy className="h-3 w-3" /> Copy all
              </button>
            </div>
            <ul className="max-h-56 space-y-0.5 overflow-auto rounded-md border border-warn/30 bg-warn/5 p-2">
              {issued.map((i) => (
                <li
                  key={i.participantId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate uppercase">{i.name}</span>
                  <code className="font-mono font-bold tracking-[0.2em] text-warn">{i.code}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!issued && (claims.data?.length ?? 0) > 0 && (
          <ul className="mt-3 max-h-40 space-y-0.5 overflow-auto pr-1">
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
                        ? "text-[10px] uppercase tracking-widest text-primary"
                        : "text-[10px] uppercase tracking-widest text-muted-foreground"
                    }
                  >
                    {claim?.claimed_at ? "claimed" : claim ? "code issued" : "no code"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
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
    <Card className="hud-bezel border-primary/20">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-primary">
            <Trophy className="h-4 w-4" />
            <h2 className="font-display text-sm font-black uppercase tracking-[0.3em]">
              League Awards
            </h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {tally.data?.totalVotes ?? 0} votes
          </span>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          {locked
            ? "Voting is closed and winners are published on player cards."
            : "Only you can see this tally. Members see nothing until you close voting."}
        </p>

        <div className="max-h-56 space-y-2 overflow-auto pr-1">
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
              className="w-full"
            >
              <Unlock className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Working…" : "Reopen voting"}
            </Button>
          ) : (
            <Button size="sm" onClick={onClose} disabled={busy} className="w-full">
              <Lock className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Working…" : "Close voting & publish"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
