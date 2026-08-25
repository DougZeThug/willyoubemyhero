import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { Sparkles } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useMemberSession } from "@/lib/member-token";
import { useSecretActor } from "@/hooks/use-daily-secret";
import { useDustBalance } from "@/hooks/use-dust";
import { DustShopPanel } from "@/components/dust-shop";
import { dustLive } from "@/lib/dust";

export const Route = createFileRoute("/players/shop")({
  head: () => ({
    meta: [
      { title: "Dust — Will YOU Be My Hero?" },
      {
        name: "description",
        content: "Spend dust on a bonus pull, burn your spares, or settle a card's finish.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? — Dust" },
      { property: "og:description", content: "What dust buys." },
    ],
  }),
  component: ShopPage,
});

/**
 * The dust economy, with a screen of its own.
 *
 * The chrome and the fetching live here; every transaction lives in
 * DustShopPanel, which takes what it needs as props so its cache bookkeeping can
 * be pinned by a test. useEventBundle is fine on a full screen — unlike in the
 * nav, where the realtime channel it opens would ride every page.
 */
function ShopPage() {
  const { event, bundle } = useEventBundle();
  const member = useMemberSession();
  const participantId = member?.participantId ?? null;
  const actor = useSecretActor();
  const dustOn = dustLive(event);
  // Same gate the vault's chip uses: no balance to ask for while the economy is
  // off, and none to ask for on behalf of somebody with no name yet.
  const dust = useDustBalance(dustOn ? participantId : null);

  // The lists hold card copy ids; the bundle is the only place a name lives.
  const nameFor = useCallback(
    (eventParticipantId: string) =>
      bundle?.participants.find((p) => p.id === eventParticipantId)?.participant?.name ?? "—",
    [bundle],
  );

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              Economy
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">Dust</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {!dustOn
              ? "The commissioner has not switched dust on yet."
              : dust.data?.balance == null
                ? "Counting…"
                : `You have ${dust.data.balance.toLocaleString()}.`}
          </p>
        </div>

        {/* The tab disappears when dust is off, but a bookmark does not — and a
            404 on a screen that worked yesterday reads as a broken app rather
            than a switch somebody flipped. */}
        {!dustOn ? (
          <p className="text-sm text-muted-foreground">
            Nothing to spend and nothing to earn until it is.{" "}
            <Link to="/players" className="font-bold text-primary hover:underline">
              Back to the vault
            </Link>
          </p>
        ) : !participantId ? (
          <p className="text-sm text-muted-foreground">
            Dust is banked against your name rather than this phone, so it needs a claimed player.{" "}
            <Link to="/claim" className="font-bold text-primary hover:underline">
              Claim yours
            </Link>
          </p>
        ) : (
          <DustShopPanel
            balance={dust.data?.balance}
            participantId={participantId}
            actor={actor}
            eventId={event?.id ?? null}
            nameFor={nameFor}
          />
        )}
      </div>
    </div>
  );
}
