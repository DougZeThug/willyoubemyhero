import { ArrowUpDown, SlidersHorizontal } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  VAULT_FILTERS,
  VAULT_SORTS,
  type VaultDensity,
  type VaultFilter,
  type VaultSort,
} from "@/lib/vault-layout";
import { cn } from "@/lib/utils";

/**
 * Everything that used to sit above the first card.
 *
 * At 390px the vault spent six kinds of control before a single tile: Open Pack,
 * an offer pill, a claim prompt, Rearrange, four sort chips and a star apiece
 * (§3). Four of those are choices about how to READ the binder rather than
 * things to do, and choices about reading belong behind one control — which is
 * what buys the shelves the ~90px that puts the first card above the fold.
 *
 * A bottom sheet rather than a popover: this is a phone held in one hand, and
 * the bottom half of the screen is the half a thumb reaches (§26). vaul's drawer
 * is already in the tree for the trade picker and the compare sheet, so this
 * adds no dependency and no second dismissal gesture to learn.
 *
 * `aria-pressed` buttons rather than radiogroups, and that is not a shortcut —
 * see the note the sort chips carried: `role="radio"` says the same thing to a
 * screen reader and makes the controls invisible to `getByRole("button")`, which
 * is how the e2e suite reaches every one of them.
 */
export function VaultSortSheet({
  open,
  onOpenChange,
  sort,
  onSort,
  filter,
  onFilter,
  density,
  onDensity,
  rearranging,
  onRearranging,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sort: VaultSort;
  onSort: (sort: VaultSort) => void;
  filter: VaultFilter;
  onFilter: (filter: VaultFilter) => void;
  density: VaultDensity;
  onDensity: (density: VaultDensity) => void;
  rearranging: boolean;
  onRearranging: (on: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle className="font-display text-sm font-bold uppercase tracking-wide">
            Sort &amp; filter
          </DrawerTitle>
          <DrawerDescription className="text-xs">
            How the roster reads. Kept on this phone.
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-8">
          <Group label="Sort by">
            {VAULT_SORTS.map((s) => (
              <Choice
                key={s.key}
                label={s.label}
                // Shuffle re-deals every time it is pressed, so it is never
                // "already chosen" in the way the others are — pressing it again
                // is a new order, not a no-op.
                on={sort === s.key}
                onPress={() => onSort(s.key)}
              />
            ))}
          </Group>

          <Group label="Show">
            {VAULT_FILTERS.map((f) => (
              <Choice
                key={f.key}
                label={f.label}
                on={filter === f.key}
                onPress={() => onFilter(f.key)}
              />
            ))}
          </Group>

          <Group label="Card size">
            <Choice label="2 across" on={density === 2} onPress={() => onDensity(2)} />
            <Choice label="3 across" on={density === 3} onPress={() => onDensity(3)} />
          </Group>

          <Group label="Shelves">
            <Choice
              label={rearranging ? "Done rearranging" : "Rearrange shelves"}
              icon={<ArrowUpDown aria-hidden className="h-3.5 w-3.5" />}
              on={rearranging}
              onPress={() => {
                onRearranging(!rearranging);
                // Turning it on closes the sheet, because the arrows it reveals
                // are behind the sheet. Turning it off is done from here too, so
                // the control is never stranded.
                onOpenChange(false);
              }}
            />
          </Group>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-1 font-display text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </h3>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

function Choice({
  label,
  on,
  onPress,
  icon,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-label font-bold uppercase tracking-[0.08em] transition-colors",
        on
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** The one control the sheet is behind, on the Roster shelf's header. */
export function VaultSortChip({ onOpen, active }: { onOpen: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Sort and filter the roster"
      className={cn(
        "ml-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-label font-bold uppercase tracking-[0.08em] transition-colors",
        // Lit while anything is off the default, so a filtered shelf never looks
        // like a shelf that has lost cards.
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
      Sort &amp; filter
    </button>
  );
}
