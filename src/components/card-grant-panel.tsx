import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Gift } from "lucide-react";
import { grantCard } from "@/lib/card-pulls.functions";
import { newClientKey } from "@/lib/format";
import { EDITION_ORDER, type Edition } from "@/lib/card-edition";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";

/**
 * Hand a player a base card.
 *
 * The repair tool for a collection that went missing — most of it packed on a
 * phone before that phone knew who was holding it, which the server had no
 * record of until adoption shipped. Copies are filed as `grant`, so they are
 * distinguishable from pulls forever and never occupy somebody's one pull a day.
 */
export function CardGrantPanel({ eventId }: { eventId: string }) {
  const { bundle } = useEventBundle();
  const grantFn = useServerFn(grantCard);
  const [to, setTo] = useState("");
  const [card, setCard] = useState("");
  const [edition, setEdition] = useState<Edition>("standard");
  const [busy, setBusy] = useState(false);
  /**
   * The key for the grant currently being attempted, held across a failure so a
   * retry replays it. A request that timed out after the server had committed
   * used to hand out a real second copy on the next tap — the only thing
   * standing in the way was a spinner, which does not survive a reload.
   *
   * Cleared on success, and whenever the selection changes, because either of
   * those makes the next tap a different grant.
   */
  const grantKey = useRef<string | null>(null);
  useEffect(() => {
    grantKey.current = null;
  }, [to, card, edition]);

  const roster = bundle?.participants ?? [];
  const nameOf = (participantId: string) =>
    roster.find((p) => p.participant_id === participantId)?.participant?.name ?? "this player";

  async function onGrant() {
    if (!to || !card) {
      toast.error("Pick a player and a card");
      return;
    }
    const cardName = roster.find((p) => p.id === card)?.participant?.name ?? "that card";
    if (!confirm(`Give ${nameOf(to)} a ${edition} ${cardName} card?`)) return;
    setBusy(true);
    try {
      grantKey.current ??= newClientKey();
      const res = await grantFn({
        data: {
          eventId,
          participantId: to,
          eventParticipantId: card,
          edition,
          grantKey: grantKey.current,
        },
      });
      grantKey.current = null;
      toast.success(
        res.repeat
          ? `Already given — ${nameOf(to)} holds ${res.copies} × ${cardName}`
          : `${nameOf(to)} now holds ${res.copies} × ${cardName}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not grant that card");
    } finally {
      setBusy(false);
    }
  }

  const selectClass =
    "min-h-11 w-full rounded-md border border-primary/30 bg-background px-2 text-xs uppercase tracking-widest text-foreground";

  return (
    <AdminSection icon={<Gift className="h-4 w-4 shrink-0" />} title="Give a Card">
      <p className="mb-3 text-xs text-muted-foreground">
        Hands a player a copy of a base card. For putting back cards somebody lost — it does not
        count as one of their daily pulls, and the public “packed by” number moves the same way a
        real pull would.
      </p>

      <div className="space-y-2">
        <select
          aria-label="Player"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={selectClass}
        >
          <option value="">Give to…</option>
          {roster.map((p) => (
            <option key={p.participant_id} value={p.participant_id}>
              {p.participant?.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Card"
          value={card}
          onChange={(e) => setCard(e.target.value)}
          className={selectClass}
        >
          <option value="">Which card…</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.participant?.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Finish"
          value={edition}
          onChange={(e) => setEdition(e.target.value as Edition)}
          className={selectClass}
        >
          {EDITION_ORDER.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <Button size="sm" onClick={onGrant} disabled={busy} className="min-h-11 w-full sm:min-h-0">
          <Gift className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Giving…" : "Give card"}
        </Button>
      </div>
    </AdminSection>
  );
}
