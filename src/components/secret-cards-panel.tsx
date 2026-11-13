import { useRef, useState } from "react";
import { plural } from "@/components/plural";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { newClientKey } from "@/lib/format";
import { toast } from "sonner";
import { ChevronDown, EyeOff, Loader2 } from "lucide-react";
import {
  grantSecretCard,
  listSecretCards,
  updateSecretCard,
  updateSecretCollectionLook,
} from "@/lib/secret-cards.functions";
import { AdminSection } from "@/components/admin-section";
import { BorderFxPicker, FoilPicker } from "@/components/secret-look-picker";
import {
  type SecretCollection,
  groupBySecretCollection,
  secretCollectionLabel,
} from "@/lib/secret-cards";
import { SecretCardEditSheet } from "@/components/secret-card-edit-sheet";
import { SecretSetManager } from "@/components/secret-set-manager";
import { SecretUploadDrafts, type Draft } from "@/components/secret-upload-drafts";
import { useSecretSave } from "@/components/use-secret-save";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { useIdSet } from "@/components/use-id-set";
import { useKeyedQueue } from "@/components/admin/use-keyed-queue";
import {
  SecretCardTile,
  type Roster,
  type SecretCardAdminRow,
} from "@/components/secret-card-tile";
import { cn } from "@/lib/utils";

/**
 * Authoring the secret set.
 *
 * These rows belong to the league, not to a combine, so nothing here takes an
 * event id — see requireLeagueAdmin. The panel is the only place in the app that
 * sees the whole set, and the owner counts are the one thing that escapes the
 * silence rule: without them the commissioner cannot tell when everyone has found
 * everything and the daily drop has quietly become nothing but duplicates.
 */
export function SecretCardsPanel() {
  const save = useSecretSave();
  const { busy, run } = useAdminAction();
  const listFn = useServerFn(listSecretCards);
  const updateFn = useServerFn(updateSecretCard);
  const setLookFn = useServerFn(updateSecretCollectionLook);
  const grantFn = useServerFn(grantSecretCard);
  /** See `grant` below: the in-flight grant key per card+recipient. */
  const grantKeys = useRef(new Map<string, string>());

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  // Per-card grant target: the participant id currently chosen in that row's picker.
  const [grantTarget, setGrantTarget] = useState<Record<string, string>>({});
  // Per-row pending flags are sets, not single ids — see useIdSet. A weight saves
  // on blur, a look on every pick and a grant on every tap, so two rows can be in
  // flight at once.
  const granting = useIdSet();
  const savingWeight = useIdSet();
  // Look saves chain per card, and per set ("" for unsorted) — see useKeyedQueue.
  const cardLooks = useKeyedQueue();
  const setLooks = useKeyedQueue();
  // The one row whose border previews may animate — see BorderFxPicker.animate.
  const [lookRow, setLookRow] = useState<string | null>(null);
  // Expanded sets, by id ("" for unsorted). Tracked as "what is open" rather than
  // "what is closed" so a set created after this mounted is closed like the rest
  // instead of springing open because nobody had listed it as collapsed.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // No eventId in the key, which is itself the documentation that the set is
  // league-wide — and keeps the panel from going stale when the active event
  // rolls over next year.
  const list = useQuery({
    queryKey: ["secret-cards"],
    queryFn: () => listFn(),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const cards = (list.data?.cards ?? []) as SecretCardAdminRow[];
  const roster: Roster = list.data?.participants ?? [];
  // Every set the admin has authored, in their order. Hidden ones still order
  // and label the cards already filed under them; they just stop being an option.
  const allSets = list.data?.collections ?? [];
  const sets: SecretCollection[] = allSets.map((c) => ({
    id: c.id,
    label: c.label,
    accent: c.accent,
  }));
  const pickerSets: SecretCollection[] = allSets
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, label: c.label, accent: c.accent }));
  const cardsPerSet = new Map<string, number>();
  for (const c of cards)
    if (c.collection) cardsPerSet.set(c.collection, (cardsPerSet.get(c.collection) ?? 0) + 1);

  // Weight edits save on blur / enter. Debouncing on every keystroke would hide
  // the "did it save?" moment; a full save button per row is more taps than the
  // change deserves. Leave clears back to 100 (baseline uniform).
  async function saveWeight(id: string, raw: string) {
    const parsed = raw.trim() === "" ? 100 : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
      toast.error("Weight must be a whole number between 0 and 10,000");
      return;
    }
    savingWeight.add(id);
    await save(updateFn({ data: { id, weight: parsed } }), {
      loading: "Saving weight…",
      success:
        parsed === 0 ? "Weight saved — card excluded from packs" : `Weight saved (${parsed})`,
      failure: "Save failed",
    });
    savingWeight.remove(id);
  }

  // Unlike weight there is no blur ambiguity: picking an option *is* the intent,
  // so a look saves on change.
  //
  // The strips stay enabled while that save is in flight, which is not an
  // oversight: disabling a focused radio hands focus back to <body>, so a
  // keyboard user would get exactly one arrow press per round-trip and then have
  // to Tab back in. The spinner is the in-flight signal instead, and the queue
  // is what the `disabled` was really guarding.
  function saveLook(
    id: string,
    look: { foil?: string; borderFx?: string; collection?: string | null },
  ) {
    cardLooks.enqueue(id, () =>
      save(updateFn({ data: { id, ...look } }), {
        // A stable id per card, so arrowing across thirteen foils replaces one
        // toast rather than stacking thirteen.
        id: `look-${id}`,
        loading: look.collection !== undefined ? "Filing card…" : "Saving look…",
        success:
          look.collection !== undefined
            ? `Filed under ${secretCollectionLabel(look.collection, sets)}`
            : "Look saved",
        failure: "Save failed",
      }),
    );
  }

  /**
   * One foil or border for a whole set. A single server write rather than a
   * loop of per-card saves: filing twelve WAGs under one look is the unit an
   * admin actually thinks in, and twelve round trips is what made them not do it.
   */
  function saveSetLook(
    collection: string | null,
    label: string,
    look: { foil?: string; borderFx?: string },
  ) {
    const key = collection ?? "";
    setLooks.enqueue(key, () =>
      save(setLookFn({ data: { collection, ...look } }), {
        id: `set-look-${key}`,
        loading: `Applying to ${label}…`,
        success: (r) => `${label}: ${plural(r.updated, "card")} updated`,
        failure: "Save failed",
      }),
    );
  }

  async function grant(card: SecretCardAdminRow) {
    const participantId = grantTarget[card.id];
    if (!participantId) {
      toast.error("Pick a participant first");
      return;
    }
    const who = roster.find((p) => p.id === participantId)?.name ?? "participant";
    granting.add(card.id);
    // One key per grant the commissioner meant to make, kept across a failure so
    // a retry replays it rather than dealing a second copy. Keyed by card and
    // recipient, so changing either starts a new grant.
    const intent = `${card.id}:${participantId}`;
    if (grantKeys.current.get(intent) === undefined) {
      grantKeys.current.set(intent, newClientKey());
    }
    const grantKey = grantKeys.current.get(intent)!;
    const ok = await save(
      grantFn({ data: { participantId, cardId: card.id, grantKey } }).then((r) => {
        grantKeys.current.delete(intent);
        return r;
      }),
      {
        loading: `Granting "${card.name}" to ${who}…`,
        success: (r) =>
          r.repeat
            ? `"${card.name}" was already granted to ${who}`
            : r.duplicate
              ? `${who} already had "${card.name}" — logged as a duplicate`
              : // The commissioner's copy of a ceremony they cannot see: the recipient
                // is somewhere else holding their own phone, and finds out through the
                // realtime subscription on collection_trophies rather than from here.
                r.completedCollection
                ? `Granted "${card.name}" — that finished ${r.completedCollection.label} for ${who}`
                : `Granted "${card.name}" to ${who}`,
        failure: "Grant failed",
      },
    );
    if (ok) setGrantTarget((prev) => ({ ...prev, [card.id]: "" }));
    granting.remove(card.id);
  }

  const editingCard = cards.find((c) => c.id === editing) ?? null;

  return (
    // EyeOff rather than Sparkles: Sparkles already belongs to the pack.
    <AdminSection
      icon={<EyeOff className="h-4 w-4 shrink-0" />}
      title="Secret Cards"
      meta={`${cards.length} in the set`}
      defaultOpen
    >
      <p className="text-[11px] leading-snug text-muted-foreground">
        Secret cards belong to the league, not to one combine. Upload once and they keep turning up
        in packs every year.
      </p>
      {list.data?.exhausted && (
        <p className="mt-1 text-[11px] leading-snug text-warn">
          {/* The same filter the server decides `exhausted` with — weight 0 takes a
              card out of the draw without retiring it, so counting it here made
              the sentence name a total nobody could ever have pulled. */}
          Everyone who plays has pulled all{" "}
          {cards.filter((c) => c.active && c.hasArt && c.weight > 0).length}. New cards show up in
          tomorrow&apos;s packs.
        </p>
      )}

      <SecretUploadDrafts
        drafts={drafts}
        setDrafts={setDrafts}
        pickerSets={pickerSets}
        busy={busy}
        run={run}
      />

      <SecretSetManager sets={allSets} cardsPerSet={cardsPerSet} />

      <div className="mt-3 space-y-3">
        {cards.length === 0 && drafts.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No secret cards yet. Packs will just be three cards until there&apos;s at least one.
          </p>
        )}
        {/* One collapsible section per set. The whole point is that the list stays
            navigable at forty cards, which it does not as one flat scroll. */}
        {groupBySecretCollection(cards, sets).map((group) => {
          const key = group.id ?? "";
          const open = expanded.has(key);
          return (
            <section
              key={key}
              className={cn("rounded-lg border", group.accent ? "border" : "border-white/10")}
              style={
                group.accent
                  ? {
                      // Flat hue, not a wash: one even tint of the set's colour.
                      background: `color-mix(in oklab, ${group.accent} 10%, var(--card))`,
                      borderColor: `color-mix(in oklab, ${group.accent} 35%, transparent)`,
                      boxShadow: open
                        ? `0 0 24px -6px color-mix(in oklab, ${group.accent} 55%, transparent)`
                        : undefined,
                    }
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                aria-expanded={open}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left"
              >
                <span
                  className="truncate font-display text-xs font-black uppercase tracking-[0.08em] text-primary"
                  style={group.accent ? { color: group.accent } : undefined}
                >
                  {group.label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">
                    {group.items.length}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "h-4 w-4 text-primary/70 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </span>
              </button>
              {open && (
                <div className="space-y-2 p-2 pt-0">
                  <SetLookRow
                    label={group.label}
                    foil={sharedValue(group.items.map((c) => c.foil))}
                    borderFx={sharedValue(group.items.map((c) => c.borderFx))}
                    saving={setLooks.pending(key)}
                    onChange={(look) => saveSetLook(group.id, group.label, look)}
                  />
                  {group.items.map((card) => (
                    <SecretCardTile
                      key={card.id}
                      card={card}
                      claimedMembers={list.data?.claimedMembers ?? 0}
                      roster={roster}
                      sets={pickerSets}
                      allSets={sets}
                      busy={busy}
                      grantTarget={grantTarget[card.id] ?? ""}
                      onGrantTargetChange={(participantId) =>
                        setGrantTarget((prev) => ({ ...prev, [card.id]: participantId }))
                      }
                      granting={granting.has(card.id)}
                      savingWeight={savingWeight.has(card.id)}
                      savingLook={cardLooks.pending(card.id)}
                      lookRow={lookRow === card.id}
                      onLookRowChange={(active) =>
                        setLookRow((prev) => (active ? card.id : prev === card.id ? null : prev))
                      }
                      onSaveWeight={(raw) => void saveWeight(card.id, raw)}
                      onSaveLook={(look) => saveLook(card.id, look)}
                      onSaveCollection={(collection) => saveLook(card.id, { collection })}
                      onGrant={() => void grant(card)}
                      onEdit={() => setEditing(card.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <SecretCardEditSheet
        card={editingCard}
        claimedMembers={list.data?.claimedMembers ?? 0}
        sets={sets}
        pickerSets={pickerSets}
        busy={busy}
        run={run}
        onSaveLook={saveLook}
        onClose={() => setEditing(null)}
      />
    </AdminSection>
  );
}

/** The one value every card in a set shares, or null when they differ. */
function sharedValue(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? (first ?? null) : null;
}

/**
 * Foil and border for a whole set.
 *
 * The same swatch strips the tiles wear, so the colour is on screen at the
 * moment of choosing. A set whose cards disagree shows "Mixed" with nothing
 * ticked — a real state, so it is selectable-from but never selectable-to.
 */
function SetLookRow({
  label,
  foil,
  borderFx,
  saving,
  onChange,
}: {
  label: string;
  foil: string | null;
  borderFx: string | null;
  saving: boolean;
  onChange: (look: { foil?: string; borderFx?: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-white/10 bg-white/[0.03] p-2">
      <span className="flex items-center gap-2 text-label uppercase tracking-[0.08em] text-muted-foreground">
        Whole set
        {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      </span>
      <FoilPicker
        value={foil}
        cardName={`every card in ${label}`}
        unsetLabel="Mixed"
        disabled={saving}
        onChange={(id) => onChange({ foil: id })}
      />
      <BorderFxPicker
        value={borderFx}
        foil={foil}
        cardName={`every card in ${label}`}
        unsetLabel="Mixed"
        disabled={saving}
        onChange={(id) => onChange({ borderFx: id })}
      />
    </div>
  );
}
