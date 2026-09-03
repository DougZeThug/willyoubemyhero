import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PanelBottom } from "lucide-react";
import { toast } from "sonner";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setNavHidden } from "@/lib/nav.functions";
import { DUST_ROW_ID, navTabs, PINNED_ROW_IDS, type NavRowId } from "@/lib/nav";

/** Why a row has no switch here, for the two that do not. */
const FIXED_REASON: Partial<Record<NavRowId, string>> = {
  vault: "The wordmark, the shop's way back and every player card land here.",
  shop: "Comes and goes with the dust switch above, and with nothing else.",
};

/**
 * Which rows the navigation carries.
 *
 * BOTH NAVS, not just the phone's. `navTabs` feeds the bottom bar and the header
 * on a wide screen from one list, which is how the shop has always worked — a
 * destination present in one nav and missing from the other would be two
 * different apps for the same league, and activeTab would light a tab a phone
 * does not have. The copy here says so; an earlier draft called this the bottom
 * bar and was wrong about its own reach.
 *
 * SWITCHES OVER A DRAFT, ONE SAVE — the stations panel's shape rather than the
 * dust panel's pair of buttons. Dust objects to a control that "commits the
 * moment a thumb brushes it", which is an objection to commit timing and not to
 * the widget: behind a Save nothing commits on touch, which is why the console's
 * other Switch is allowed to exist.
 *
 * And the column holds ONE array, so one Save is one statement that either lands
 * or does not. A button per row would be four writes, four chances to half-land,
 * and no moment where the commissioner sees the bar they are about to ship. The
 * preview line is that moment.
 *
 * Vault and Shop are listed and inert with their reason underneath. Leaving them
 * out would make this a partial account of a bar the commissioner is looking at,
 * and "why can't I turn the shop off here" is worth answering once in the
 * interface rather than every year in person.
 */
export function NavRowsPanel({
  eventId,
  hidden,
  dustOn,
}: {
  eventId: string;
  hidden: readonly string[];
  dustOn: boolean;
}) {
  const qc = useQueryClient();
  const setFn = useServerFn(setNavHidden);
  const [busy, setBusy] = useState(false);

  // Keyed on the VALUE rather than the array's identity: `hidden` is rebuilt by
  // navHidden on every render, so re-seeding on identity would wipe a
  // half-finished draft every time anything else in the console re-rendered.
  // Re-seeding on the value is wanted — this panel and the bar read the same
  // ["active-event"] query, so a save landing should reach these switches.
  const storedKey = [...hidden].sort().join(" ");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(hidden));
  useEffect(() => {
    setDraft(new Set(storedKey ? storedKey.split(" ") : []));
  }, [storedKey]);

  const dirty = [...draft].sort().join(" ") !== storedKey;
  const saved = navTabs({ dustOn, hidden });
  // Built exactly the way SiteNav builds it, so the preview cannot disagree with
  // the bar about order, about the shop, or about the pin.
  const preview = navTabs({ dustOn, hidden: [...draft] });
  const shape = preview.map((t) => t.label).join(" · ");
  const rows = navTabs({ dustOn: true });

  async function save() {
    if (
      !confirm(
        `Save the nav as ${shape}? That is what everybody sees, on a phone and on a ` +
          `laptop. Anything you take off still works — links, bookmarks and the QR code ` +
          `all still reach it, it just has no tab.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await setFn({ data: { eventId, hidden: [...draft] as NavRowId[] } });
      // The list rides on the active event, which is the query the bar reads and
      // the one this panel is seeded from — one key refreshes both.
      await qc.invalidateQueries({ queryKey: ["active-event"] });
      toast.success(`Nav saved — ${preview.length} row${preview.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Could not change that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSection
      icon={<PanelBottom className="h-4 w-4 shrink-0" />}
      title="Navigation"
      meta={`${saved.length} row${saved.length === 1 ? "" : "s"}`}
    >
      <p className="text-sm text-muted-foreground">
        Which rows the nav carries — the phone&apos;s bottom bar and the header on a wide screen,
        which hold the same set. Switching one off takes the tab away and nothing else: the screen
        behind it still answers.
      </p>

      <ul className="mt-3 space-y-1">
        {rows.map((row) => {
          const Icon = row.icon;
          const reason = FIXED_REASON[row.id];
          const fixed = row.id === DUST_ROW_ID || PINNED_ROW_IDS.includes(row.id);
          const on = fixed ? row.id !== DUST_ROW_ID || dustOn : !draft.has(row.id);
          return (
            <li key={row.id} className="flex min-h-11 items-center justify-between gap-3">
              <Label
                htmlFor={`nav-row-${row.id}`}
                className={fixed ? "text-muted-foreground" : undefined}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {row.label}
                </span>
                {reason && <span className="mt-0.5 block text-meta font-normal">{reason}</span>}
              </Label>
              <Switch
                id={`nav-row-${row.id}`}
                checked={on}
                disabled={fixed || busy}
                onCheckedChange={(next) =>
                  setDraft((d) => {
                    const copy = new Set(d);
                    if (next) copy.delete(row.id);
                    else copy.add(row.id);
                    return copy;
                  })
                }
              />
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-muted-foreground">
        {dirty ? "Will hold" : "Holds"} {shape}.
      </p>

      <div className="mt-3">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="min-h-11 w-full sm:min-h-0"
        >
          {busy ? "Saving…" : dirty ? "Save the nav" : "Saved"}
        </Button>
      </div>
    </AdminSection>
  );
}
