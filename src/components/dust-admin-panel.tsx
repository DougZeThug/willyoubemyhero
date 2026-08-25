import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { setDustEnabled } from "@/lib/dust.functions";
import { DUPE_SECRET_CREDIT, DUST_PRICES } from "@/lib/dust";

/**
 * The switch for the whole dust economy.
 *
 * Two states rather than a Switch, matching AwardsAdminPanel: the only real
 * `<Switch>` in this console edits local draft state inside a form, and a
 * control that commits the moment a thumb brushes it is the wrong shape for
 * something that turns a feature on for thirteen people at once.
 *
 * The button says what will happen, not what is true — "Turn dust on" reads as
 * an action, where a checked box reads as a status and gets misread in a garden.
 */
export function DustAdminPanel({ eventId, enabled }: { eventId: string; enabled: boolean }) {
  const qc = useQueryClient();
  const setFn = useServerFn(setDustEnabled);
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    if (
      !confirm(
        next
          ? `Turn dust on? Duplicate secrets start paying ${DUPE_SECRET_CREDIT}, and the shop appears for everyone.`
          : "Turn dust off? The chip and shop disappear and nothing accrues while it is off. Balances already earned are kept.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await setFn({ data: { eventId, enabled: next } });
      // The flag rides on the active event, which is what every screen reads to
      // decide whether the chip exists.
      await qc.invalidateQueries({ queryKey: ["active-event"] });
      toast.success(next ? "Dust is live" : "Dust is off");
    } catch {
      toast.error("Could not change that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSection
      icon={<Sparkles className="h-4 w-4 shrink-0" />}
      title="Dust"
      meta={enabled ? "Live" : "Off"}
    >
      <p className="text-sm text-muted-foreground">
        {enabled
          ? `Duplicate secrets pay ${DUPE_SECRET_CREDIT}. Players can burn spares, buy a pull for ${DUST_PRICES.bonusPull} and re-roll a finish for ${DUST_PRICES.reroll}.`
          : "Nobody can see or spend dust, and nothing accrues while it is off — the day you turn it on, everyone starts level."}
      </p>
      <div className="mt-3">
        <Button
          size="sm"
          variant={enabled ? "secondary" : "default"}
          onClick={() => flip(!enabled)}
          disabled={busy}
          className="min-h-11 w-full sm:min-h-0"
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Working…" : enabled ? "Turn dust off" : "Turn dust on"}
        </Button>
      </div>
    </AdminSection>
  );
}
