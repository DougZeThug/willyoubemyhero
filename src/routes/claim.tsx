import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, LogOut, ShieldCheck, UserRoundCheck } from "lucide-react";
import { claimPlayer, getClaimRoster } from "@/lib/member.functions";
import { linkClaimedPlayer } from "@/lib/account.functions";
import { signOutAccount, useAuthUser } from "@/hooks/use-account";
import { clearMemberToken, setMemberToken, useMemberSession } from "@/lib/member-token";
import {
  adoptableIds,
  adoptLocalCollection,
  snapshotLocalCollection,
} from "@/lib/adopt-collection";
import { carryPackToIdentity } from "@/lib/card-collection";
import { carryTrophySeen } from "@/lib/trophy-seen";
import { deviceId } from "@/lib/device-id";
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
  const linkFn = useServerFn(linkClaimedPlayer);
  const { user } = useAuthUser();

  const roster = useQuery({
    queryKey: ["claim-roster"],
    queryFn: () => rosterFn(),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Once you're claimed there's nothing to do here but sign out.
  useEffect(() => {
    if (session) setSelected(session.participantId);
  }, [session]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !code.trim() || busy) return;
    setBusy(true);
    try {
      // Read the cards on this handset BEFORE it becomes a member: the collection
      // hook starts pruning against the server the instant the token lands.
      const held = await snapshotLocalCollection();
      const res = await claimFn({ data: { participantId: selected, code: code.trim() } });
      if (!res.ok) {
        // Distinguished from a wrong code: during a lockout the RIGHT code
        // fails too, and "doesn't match" would read as a misprinted card.
        toast.error(
          res.reason === "too_many_attempts"
            ? "Too many tries for this player — wait a few minutes."
            : "That code doesn't match",
        );
        setCode("");
        return;
      }
      // The token has to land first — `adoptCollection` authenticates as the
      // member it is filing cards for. But the moment it lands, the collection
      // hook starts reconciling this device against a server record that has
      // never heard of these guest cards, and an empty `card_pulls` reads as
      // "you own nothing" rather than "we don't know", so it deletes them. So if
      // adoption does not stick, the token comes straight back off: no member,
      // no reconciliation, nothing pruned, and the code still works next time.
      setMemberToken(res.token, res.name);
      try {
        await adoptLocalCollection(held);
      } catch {
        try {
          // One retry, because the usual failure here is a flaky first request
          // from a phone that has just woken up on garden wifi.
          await adoptLocalCollection(held);
        } catch {
          clearMemberToken();
          toast.error(
            "Claimed, but your cards couldn't be transferred — your code still works, try again on a better connection.",
          );
          return;
        }
      }
      // Their guest pack and their guest ceremonies follow them across, now that
      // the cards themselves have. Both are keyed on the identity `usePackIdentity`
      // hands out, and a claim moves that from `d:<deviceId>` to `m:<participantId>`
      // — which every screen keyed on it reads as the handset changing hands. See
      // B-07 on the pack row and B-13 on the trophies. After the adoption, because
      // the adoption is what makes carrying the pack safe: it is the record for
      // these cards, so the member must not file them a second time.
      const device = deviceId();
      if (device) {
        await carryPackToIdentity(`d:${device}`, `m:${selected}`, adoptableIds(held));
        carryTrophySeen(`d:${device}`, selected);
      }
      // Signed in? Then the player follows the account, not the handset. Awaited
      // so the next screen's reads already see the bound identity. A THROW here
      // is transient and swallowed — a claim that worked is worth more than a
      // link that didn't, and signing in again re-runs the adoption. A refusal
      // is not transient and is not swallowed: the account keeps pointing at the
      // player it already holds, so the next phone to sign in gets that one
      // back, and saying "Welcome" over that is the app confirming something it
      // did not do.
      if (user) {
        try {
          const link = await linkFn({ data: undefined });
          if (!link.ok) {
            toast.error(
              link.boundName
                ? `Claimed on this phone, but your account is already ${link.boundName} — sign out of the account first, or use a different one.`
                : "Claimed on this phone, but your account is already linked to another player — sign out of the account first, or use a different one.",
              { duration: 10_000 },
            );
            navigate({ to: "/players" });
            return;
          }
        } catch {
          /* the claim stands; signing in again re-runs the adoption */
        }
      }

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
                <Link to="/players" className="neon-btn-sm">
                  Go to the vault
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={signingOut}
                  onClick={async () => {
                    setSigningOut(true);
                    try {
                      // The account session too, when there is one. Dropping the
                      // member token alone silently reversed itself: useAccountSync
                      // is latched per user id and re-mints it on the next reload,
                      // so the control undid its own work.
                      if (user) await signOutAccount();
                      clearMemberToken();
                      setCode("");
                      toast.success(
                        user ? "Signed out of your account" : "Signed out on this device",
                      );
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not sign out");
                    } finally {
                      setSigningOut(false);
                    }
                  }}
                >
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  {user ? "Sign out" : "Sign out on this device"}
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
          {/* The old copy said "One time only — it sticks on this device", which
              is the opposite of what claimPlayer does: codes stay valid on
              purpose, because people get new phones and clear browsers. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Pick your name and enter the code the commissioner gave you. It keeps working — use the
            same code on a new phone whenever you need to.
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
                {/* Collectors are signed-in traders, not athletes — there is no
                    paper code to type here for them. */}
                {(roster.data ?? [])
                  .filter((p) => !p.isCollector)
                  .map((p) => (
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

        {/* The other half of the trading gate: somebody sent here who is not on
            the roster has no code to type and needs the account route. */}
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Not on the roster?{" "}
          <Link
            to="/auth"
            search={{ mode: "signup" as const, next: undefined }}
            className="font-bold text-primary underline"
          >
            Create an account
          </Link>{" "}
          to collect and trade.
        </p>
      </div>
    </div>
  );
}
