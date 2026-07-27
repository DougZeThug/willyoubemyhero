import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, LogOut, ShieldCheck, UserRoundCheck } from "lucide-react";
import { claimPlayer, getClaimRoster } from "@/lib/member.functions";
import { clearMemberToken, setMemberToken, useMemberSession } from "@/lib/member-token";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/claim")({
  head: () => ({
    meta: [
      { title: "Claim Your Player — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content: "Claim your player card to react, talk trash, and vote on league awards.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClaimPage,
});

function ClaimPage() {
  const navigate = useNavigate();
  const session = useMemberSession();
  const rosterFn = useServerFn(getClaimRoster);
  const claimFn = useServerFn(claimPlayer);

  const roster = useQuery({
    queryKey: ["claim-roster"],
    queryFn: () => rosterFn(),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Once you're claimed there's nothing to do here but sign out.
  useEffect(() => {
    if (session) setSelected(session.participantId);
  }, [session]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !code.trim() || busy) return;
    setBusy(true);
    try {
      const res = await claimFn({ data: { participantId: selected, code: code.trim() } });
      if (!res.ok) {
        toast.error("That code doesn't match");
        setCode("");
        return;
      }
      setMemberToken(res.token, res.name);
      toast.success(`Welcome, ${res.name}`);
      navigate({ to: "/players" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not claim");
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto grid max-w-md place-items-center px-4 py-12">
          <Card className="hud-bezel w-full border-primary/30">
            <CardContent className="space-y-4 p-6 text-center">
              <BadgeCheck className="mx-auto h-10 w-10 text-primary" />
              <div>
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                  Signed in as
                </div>
                <div className="font-display text-2xl font-black uppercase leading-none">
                  {session.name ?? "Your player"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                You can react to cards, post trash talk, and vote on league awards.
              </p>
              <div className="flex flex-col gap-2">
                <Link to="/players" className="neon-btn !py-2 !text-xs">
                  Go to the vault
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    clearMemberToken();
                    setCode("");
                    toast.success("Signed out on this device");
                  }}
                >
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  Sign out on this device
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="mb-5 border-b border-primary/20 pb-4 text-center">
          <div className="flex items-center justify-center gap-2 text-primary">
            <UserRoundCheck className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              League Members
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">
            Claim Your Player
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Pick your name and enter the code the commissioner gave you. One time only — it sticks
            on this device.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <Label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Who are you?
            </Label>
            {roster.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading roster…</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {(roster.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      "truncate rounded-md border px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide transition-colors",
                      selected === p.id
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-white/10 bg-white/[0.02] text-foreground hover:border-primary/40",
                    )}
                  >
                    {p.name}
                    {p.claimed && (
                      <span className="ml-1 text-[9px] font-bold tracking-widest text-muted-foreground">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label
              htmlFor="member-code"
              className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
            >
              Your code
            </Label>
            <Input
              id="member-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXXXX"
              className="text-center font-display text-2xl tracking-[0.4em]"
            />
          </div>

          <Button type="submit" disabled={busy || !selected || !code.trim()} className="w-full">
            {busy ? "Checking…" : "Claim"}
          </Button>
        </form>

        <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
          No passwords and no email. Your code only proves which player you are, so the league can
          see who reacted and who voted.
        </p>
      </div>
    </div>
  );
}
