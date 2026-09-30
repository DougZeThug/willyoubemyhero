import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createCollectorIdentity } from "@/lib/collector.functions";
import { clearMemberToken, setMemberToken, useMemberSession } from "@/lib/member-token";
import { useAuthUser } from "@/hooks/use-account";
import { clearGuestToken } from "@/lib/guest-token";
import { clearAccountHandoff } from "@/lib/account-handoff";
import { adoptLocalCollection, snapshotLocalCollection } from "@/lib/adopt-collection";
import { cn } from "@/lib/utils";

/**
 * The one-time name prompt for a signed-in person who is not on the roster.
 *
 * They can never claim a paper code, so until they name themselves their cards
 * are filed against the handset and no offer can reach them — the "they signed
 * in and I still can't trade with them" report. It used to live only on the
 * trading post, which is the one screen a new collector has no reason to open;
 * it now sits on the vault and the pack screen too, where they actually land.
 */
export function CollectorSignup({ className }: { className?: string }) {
  const qc = useQueryClient();
  const createFn = useServerFn(createCollectorIdentity);
  const { user } = useAuthUser();
  const [name, setName] = useState(() => suggestName(user?.email ?? null));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const displayName = name.trim();
    if (displayName.length < 2 || busy) return;
    setBusy(true);
    try {
      // Snapshotted before the token lands, exactly as the claim page does: a
      // guest's base cards live only on this handset until they are adopted.
      const held = await snapshotLocalCollection();
      const res = await createFn({ data: { displayName } });
      clearGuestToken();
      clearAccountHandoff();
      // The claim screen's rule, which this door used to be the only one to
      // skip. `createCollector` reparents the guest's `pack_opens` rows but
      // mints no `card_copies` — this call is the only thing that files the
      // cards themselves — so a swallowed failure left the token on over a
      // server record that has never heard of them, and the next stats read
      // said "you own nothing" rather than "we don't know". `useMyCollection`
      // believes it and `forgetCards` deletes them. Today's cards come back on
      // a re-tear; an earlier league day's do not. So if the upload does not
      // stick, the token comes straight back off: no member, no reconciliation,
      // nothing pruned, and the next sign-in replays the whole handoff against
      // a store the prune has not been through.
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
            "Named, but your cards couldn't be transferred — sign in again on a better connection.",
          );
          return;
        }
      }
      await qc.invalidateQueries();
      toast.success(`You're in, ${res.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set that up");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cn("surface-panel rounded-xl border border-primary/30 p-4", className)}
    >
      <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-primary">
        Pick a trading name
      </h2>
      <p className="mt-1 text-meta text-muted-foreground">
        You&apos;re not in the combine, but you can still collect and trade. This is the name the
        league sees on your offers.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={32}
        placeholder="Your name"
        className="mt-3 min-h-11 w-full rounded-md border border-border-strong bg-white/[0.03] px-3 py-2 text-base text-foreground outline-none focus:border-primary/60 pointer-fine:min-h-0 pointer-fine:text-sm"
      />
      <button
        type="submit"
        disabled={busy || name.trim().length < 2}
        className="neon-btn-sm mt-3 w-full disabled:opacity-50"
      >
        {busy ? "Setting up…" : "Start trading"}
      </button>
    </form>
  );
}

/**
 * Renders the prompt only for the case it fixes: signed in, no player yet.
 *
 * A member token means they are already reachable, and a signed-out guest gets
 * the ordinary claim flow — neither should see a name box.
 */
export function CollectorSignupGate({ className }: { className?: string }) {
  const { user, loading } = useAuthUser();
  const me = useMemberSession();
  if (loading || !user || me?.participantId) return null;
  return <CollectorSignup className={className} />;
}

/** "jane.doe@x.com" → "Jane Doe". A starting point they can overwrite. */
function suggestName(email: string | null): string {
  const local = (email ?? "").split("@")[0] ?? "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 32);
}
