import { Gift, Loader2, Pencil } from "lucide-react";
import { BorderFxPicker, FoilPicker } from "@/components/secret-look-picker";
import { type SecretCollection, secretCollectionLabel } from "@/lib/secret-cards";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SecretCardAdminRow = {
  id: string;
  name: string;
  flavour: string | null;
  foil: string;
  borderFx: string;
  collection: string | null;
  active: boolean;
  weight: number;
  hasArt: boolean;
  artUrl: string | null;
  ownerCount: number;
};

export type Roster = { id: string; name: string }[];

/**
 * The art thumbnail, at the shape the card actually prints at.
 *
 * Square 44px thumbnails made every card in the set look the same at a glance,
 * which is the one job a thumbnail has in a list you are scrolling on a phone.
 */
export function SecretArtThumb({
  card,
  className,
}: {
  card: SecretCardAdminRow;
  className?: string;
}) {
  return card.artUrl ? (
    <img
      src={card.artUrl}
      alt=""
      loading="lazy"
      className={cn(
        "aspect-[5/7] w-16 shrink-0 rounded-md border border-white/10 object-cover",
        className,
      )}
    />
  ) : (
    <div
      className={cn(
        "flex aspect-[5/7] w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-white/15 bg-white/5 text-center text-[9px] uppercase leading-tight tracking-widest text-muted-foreground",
        className,
      )}
    >
      No art
    </div>
  );
}

/**
 * One card in the set.
 *
 * Everything an admin does mid-scroll — weight, look, grant — stays on the tile
 * in a labelled two-column grid, because those are the edits that happen while
 * standing up. Naming, wording, replacing art and removing live behind the
 * pencil, in a sheet, where there is room to type.
 */
export function SecretCardTile({
  card,
  claimedMembers,
  roster,
  sets,
  allSets,
  grantTarget,
  onGrantTargetChange,
  granting,
  savingWeight,
  savingLook,
  lookRow,
  onLookRowChange,
  onSaveWeight,
  onSaveLook,
  onSaveCollection,
  onGrant,
  onEdit,
  busy,
}: {
  card: SecretCardAdminRow;
  claimedMembers: number;
  roster: Roster;
  sets: readonly SecretCollection[];
  /**
   * Every set, hidden ones included, so a card filed into one that has
   * since been hidden can still be named. `sets` is the pickable subset.
   */
  allSets?: readonly SecretCollection[];
  grantTarget: string;
  onGrantTargetChange: (participantId: string) => void;
  granting: boolean;
  savingWeight: boolean;
  savingLook: boolean;
  lookRow: boolean;
  onLookRowChange: (active: boolean) => void;
  onSaveWeight: (raw: string) => void;
  onSaveLook: (look: { foil?: string; borderFx?: string }) => void;
  onSaveCollection: (collection: string | null) => void;
  onGrant: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-white/[0.02] p-3",
        !card.active && "opacity-50",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <SecretArtThumb card={card} />

        <div className="min-w-0">
          <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
            {card.name}
          </div>
          {(!card.active || !card.hasArt) && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-warn">
              {!card.active ? "Retired" : "No art · not in packs"}
            </div>
          )}
          <div className="truncate text-[11px] text-muted-foreground">
            {card.flavour || "No wording yet"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Pulled by {card.ownerCount} of {claimedMembers}
          </div>
        </div>

        <button
          onClick={onEdit}
          aria-label={`Edit ${card.name}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-1"
        // Which row's border previews may animate. Pointer enter covers a mouse,
        // focus covers a keyboard, and a tap fires both.
        onPointerEnter={() => onLookRowChange(true)}
        onPointerLeave={() => onLookRowChange(false)}
        onFocusCapture={() => onLookRowChange(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) onLookRowChange(false);
        }}
      >
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Weight
          </span>
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={10000}
              step={10}
              defaultValue={card.weight}
              // Uncontrolled so typing doesn't refire the query on every keystroke.
              onBlur={(e) => {
                if (Number(e.target.value) !== card.weight) onSaveWeight(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              disabled={savingWeight}
              className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base tabular-nums sm:min-h-0 sm:h-7 sm:w-20 sm:text-xs"
              aria-label={`Pull weight for ${card.name}`}
            />
            {savingWeight && (
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </span>
        </label>

        {/* The swatch strips at every width: a native picker on a phone is a
            list of names, and "Nebula" is not a colour until you have seen it. */}
        <div className="flex flex-col gap-2">
          <FoilPicker
            value={card.foil}
            cardName={card.name}
            onChange={(foil) => onSaveLook({ foil })}
          />
          <div className="flex items-end gap-2">
            <BorderFxPicker
              value={card.borderFx}
              foil={card.foil}
              cardName={card.name}
              animate={lookRow}
              onChange={(borderFx) => onSaveLook({ borderFx })}
            />
            {savingLook && (
              <Loader2 className="mb-1.5 h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
            )}
          </div>
        </div>

        {savingLook && (
          <span className="col-span-2 flex items-center gap-1.5 text-[10px] text-muted-foreground sm:hidden">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving look…
          </span>
        )}

        <span className="col-span-2 text-[10px] text-muted-foreground sm:col-span-1">
          {card.weight === 0
            ? "Excluded from packs"
            : "Higher weight = shows up more often (100 = baseline)"}
        </span>

        <label className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Set</span>
          <select
            value={card.collection ?? ""}
            onChange={(e) => onSaveCollection(e.target.value || null)}
            className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base text-foreground sm:h-7 sm:min-h-0 sm:text-xs"
            aria-label={`Set for ${card.name}`}
          >
            <option value="">Unsorted</option>
            {/* A card filed into a set that has since been hidden keeps its own
                option, or picking anything else would be the only way out. */}
            {/* secretCollectionLabel falls back to the four SEEDED sets when
                given no list, so a commissioner-created set that has since
                been hidden rendered here as its raw uuid. `allSets` carries
                the hidden ones with their real labels. */}
            {(card.collection && !sets.some((c) => c.id === card.collection)
              ? [
                  ...sets,
                  {
                    id: card.collection,
                    label: secretCollectionLabel(card.collection, allSets ?? sets),
                  },
                ]
              : sets
            ).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {roster.length > 0 && card.hasArt && (
          <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
            <select
              value={grantTarget}
              onChange={(e) => onGrantTargetChange(e.target.value)}
              disabled={busy}
              className="min-h-11 min-w-0 flex-1 rounded border border-white/15 bg-background px-1.5 text-base sm:min-h-0 sm:h-7 sm:text-xs"
              aria-label={`Grant ${card.name} to`}
            >
              <option value="">Grant to…</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              onClick={onGrant}
              disabled={granting || !grantTarget}
              className="min-h-11 shrink-0 px-3 text-[10px] sm:min-h-0 sm:h-7 sm:px-2"
            >
              {granting ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                  Granting…
                </>
              ) : (
                <>
                  <Gift className="mr-1 h-3 w-3" />
                  Grant
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
