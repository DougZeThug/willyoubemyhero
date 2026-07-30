import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LayoutTemplate, Pipette, Plus, Trash2 } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardUrls } from "@/hooks/use-photo-urls";
import { urlFromSet } from "@/lib/media.functions";
import { setEventCardLayout, setParticipantCardLayout } from "@/lib/admin-write.functions";
import { attributeMap } from "@/lib/card-attributes";
import { cardStats } from "@/lib/card-stats";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import {
  DEFAULT_ASPECT,
  SLOT_KEYS,
  SLOT_LABELS,
  defaultLayout,
  parseCardLayout,
  readLayoutColumn,
  resolveSlot,
  type CardLayout,
  type SlotContext,
  type StatSlot,
  type StatSlotKey,
} from "@/lib/card-layout";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Put the live numbers where they belong on the artwork.
 *
 * Card fronts are uploaded images and they are not all composed the same way —
 * one has a stat panel down the bottom, another has the number over the player's
 * shoulder, a third has nothing at all. Guessing a position in code would be
 * wrong on most of them, so instead the admin drags a box onto the real card
 * once and that box is saved as the layout.
 *
 * It doubles as the way to find out what is actually printed on the set: the
 * picker walks the roster at full size, which beats opening thirteen files.
 *
 * Drag is plain pointer events with pointer capture rather than @dnd-kit. That
 * library is built for sortable lists; this is free-form drag against a
 * normalised box, and holo-card.tsx already establishes the capture idiom here.
 * Handles are sized for a thumb, but this is a sit-down job and the layout is
 * two columns from `sm:` up.
 */

/** Big enough to grab with a thumb, per the app's own 44px touch target rule. */
const HANDLE = "h-11 w-11 sm:h-6 sm:w-6";

type Mode = "event" | "player";

export function CardLayoutEditor({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const { event, bundle } = useEventBundle();
  const cards = useEventCardUrls(eventId);
  const saveEventFn = useServerFn(setEventCardLayout);
  const savePlayerFn = useServerFn(setParticipantCardLayout);

  const roster = useMemo(() => bundle?.participants ?? [], [bundle]);
  const [targetId, setTargetId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("event");
  const [layout, setLayout] = useState<CardLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ id: string; kind: "move" | "resize"; dx: number; dy: number } | null>(
    null,
  );

  const ep = roster.find((p) => p.id === targetId) ?? roster[0] ?? null;
  const eventLayout = useMemo(() => parseCardLayout(readLayoutColumn(event)), [event]);

  const ownLayout = useMemo(() => parseCardLayout(readLayoutColumn(ep)), [ep]);

  /**
   * Seed the canvas from whatever is already saved for the picked card.
   *
   * Adjusted during render keyed on the participant id, rather than in an effect
   * keyed on the row: useEventBundle refetches on every realtime run, split and
   * penalty, which during a live combine is constant. An effect that depended on
   * the row object or the parsed layout would re-seed every few seconds and
   * throw away an admin's unsaved boxes mid-drag. Switching player is the only
   * thing that should reset the canvas — and React re-renders immediately on a
   * set during render, so this never paints the stale layout.
   */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (ep && ep.id !== seededFor) {
    setSeededFor(ep.id);
    setMode(ownLayout ? "player" : "event");
    setLayout(ownLayout ?? eventLayout ?? defaultLayout());
    setSelectedId(null);
  }

  const rarities = useMemo(() => rarityMap(bundle), [bundle]);
  const attributes = useMemo(() => attributeMap(bundle), [bundle]);
  const rarity = (ep && rarities.get(ep.id)) ?? rarityStyle("base");

  // Real numbers in the preview, so a box that looks right is right. A layout
  // calibrated against placeholder text falls apart the moment "88" becomes
  // "1:04.20" and the box turns out to be half the width it needed.
  const context: SlotContext | null = ep
    ? {
        attributes: attributes.get(ep.id) ?? null,
        stats: cardStats(bundle, ep.participant_id),
        name: ep.participant?.name ?? "—",
        bib: ep.bib_number ?? null,
        pick: ep.selected_draft_position ?? null,
        rarityLabel: rarity.label,
      }
    : null;

  const artUrl = ep ? urlFromSet(cards.data?.[ep.id]?.front) : null;
  const selected = layout?.slots.find((s) => s.id === selectedId) ?? null;

  const patchSlot = useCallback((id: string, patch: Partial<StatSlot>) => {
    setLayout((prev) =>
      prev
        ? { ...prev, slots: prev.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
        : prev,
    );
  }, []);

  function onPointerDown(e: React.PointerEvent, slot: StatSlot, kind: "move" | "resize") {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(slot.id);
    // Offset from the grab point to the box's own corner, so the box doesn't
    // jump under the finger on the first move event.
    dragRef.current = {
      id: slot.id,
      kind,
      dx: (e.clientX - rect.left) / rect.width - (kind === "move" ? slot.x : slot.x + slot.w),
      dy: (e.clientY - rect.top) / rect.height - (kind === "move" ? slot.y : slot.y + slot.h),
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!drag || !rect?.width || !rect.height) return;
    const px = (e.clientX - rect.left) / rect.width - drag.dx;
    const py = (e.clientY - rect.top) / rect.height - drag.dy;
    const slot = layout?.slots.find((s) => s.id === drag.id);
    if (!slot) return;

    if (drag.kind === "move") {
      patchSlot(drag.id, {
        x: clamp(px, 0, 1 - slot.w),
        y: clamp(py, 0, 1 - slot.h),
      });
      return;
    }
    patchSlot(drag.id, {
      w: clamp(px - slot.x, 0.04, 1 - slot.x),
      h: clamp(py - slot.y, 0.03, 1 - slot.y),
    });
  }

  function endDrag(e: React.PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

  function addSlot() {
    setLayout((prev) => {
      const base = prev ?? { version: 1 as const, aspect: DEFAULT_ASPECT, slots: [] };
      // Unused keys first, so adding four slots in a row does not produce four
      // copies of the same one.
      const used = new Set(base.slots.map((s) => s.key));
      const key = SLOT_KEYS.find((k) => !used.has(k)) ?? "ovr";
      const slot: StatSlot = {
        id: `slot-${key}-${base.slots.length}`,
        key,
        x: 0.35,
        y: 0.45,
        w: 0.3,
        h: 0.12,
        size: 0.09,
        align: "center",
        color: "oklch(0.98 0 0)",
        plate: { color: "oklch(0.14 0.02 240)", radius: 0.02 },
        label: SLOT_LABELS[key].slice(0, 3).toUpperCase(),
      };
      setSelectedId(slot.id);
      return { ...base, slots: [...base.slots, slot] };
    });
  }

  function removeSelected() {
    if (!selected) return;
    setLayout((prev) =>
      prev ? { ...prev, slots: prev.slots.filter((s) => s.id !== selected.id) } : prev,
    );
    setSelectedId(null);
  }

  /**
   * Sample the artwork under the selected box for the plate colour.
   *
   * A plate that matches the pixels it covers reads as part of the card; one
   * that doesn't reads as a sticker. The browser canvas does this — the same
   * reason image-encode.ts never needed a server-side image library — and the
   * card <img> already carries crossOrigin="anonymous", which is what makes the
   * signed Supabase URL readable rather than tainting the canvas.
   */
  function sampleplate() {
    const img = imgRef.current;
    if (!img || !selected || !img.naturalWidth) {
      toast.error("No card art to sample from");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(img, 0, 0);
      const x = Math.floor((selected.x + selected.w / 2) * canvas.width);
      const y = Math.floor((selected.y + selected.h / 2) * canvas.height);
      const [r, g, b] = ctx.getImageData(clamp(x, 0, canvas.width - 1), clamp(y, 0, canvas.height - 1), 1, 1).data; // prettier-ignore
      patchSlot(selected.id, { plate: { color: `rgb(${r} ${g} ${b})`, radius: selected.plate?.radius ?? 0.02 } }); // prettier-ignore
      toast.success("Plate colour sampled from the art");
    } catch {
      // A tainted canvas throws on getImageData. Nothing recoverable, and the
      // colour picker beside this button still works.
      toast.error("Could not read the artwork's pixels");
    }
  }

  async function save(scope: Mode) {
    if (!ep) return;
    setBusy(true);
    try {
      if (scope === "event") {
        await saveEventFn({ data: { eventId, layout } });
        toast.success("Layout saved for every card in the event");
      } else {
        await savePlayerFn({
          data: { eventId, eventParticipantId: ep.id, layout },
        });
        toast.success(`Layout saved for ${ep.participant?.name ?? "this player"}`);
      }
      await qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function clear(scope: Mode) {
    if (!ep) return;
    const message =
      scope === "event"
        ? "Clear the event layout? Every card falls back to plain artwork."
        : "Clear this player's override? Their card falls back to the event layout.";
    if (!confirm(message)) return;
    setBusy(true);
    try {
      if (scope === "event") await saveEventFn({ data: { eventId, layout: null } });
      else await savePlayerFn({ data: { eventId, eventParticipantId: ep.id, layout: null } });
      await qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
      toast.success("Layout cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  }

  const hasOwnLayout = !!ownLayout;

  return (
    <AdminSection
      icon={<LayoutTemplate className="h-4 w-4 shrink-0" />}
      title="Card Stat Layout"
      meta={eventLayout ? `${eventLayout.slots.length} slots` : "Not set"}
    >
      {roster.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Add players to the event first.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="space-y-2">
            {/* text-base below sm: anything under 16px makes iOS Safari zoom the
                viewport on focus and never zoom back out. */}
            <select
              aria-label="Card to calibrate against"
              value={ep?.id ?? ""}
              onChange={(e) => setTargetId(e.target.value)}
              className="min-h-11 w-full rounded border border-white/10 bg-transparent px-2 py-1 text-base font-semibold uppercase text-foreground sm:min-h-0 sm:text-xs"
            >
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.participant?.name ?? "—"}
                  {parseCardLayout(readLayoutColumn(p)) ? " · own layout" : ""}
                </option>
              ))}
            </select>

            <div
              ref={frameRef}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="relative w-full touch-none overflow-hidden rounded-lg border border-white/15 bg-[oklch(0.16_0.02_240)]"
              style={{ aspectRatio: layout?.aspect ?? DEFAULT_ASPECT }}
            >
              {artUrl ? (
                <img
                  ref={imgRef}
                  src={artUrl}
                  alt=""
                  crossOrigin="anonymous"
                  draggable={false}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (!el.naturalWidth || !el.naturalHeight) return;
                    const aspect = el.naturalWidth / el.naturalHeight;
                    setLayout((prev) => (prev ? { ...prev, aspect } : prev));
                  }}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  No card art uploaded for this player
                </div>
              )}

              {context &&
                layout?.slots.map((slot) => {
                  const isSelected = slot.id === selectedId;
                  return (
                    <div
                      key={slot.id}
                      onPointerDown={(e) => onPointerDown(e, slot, "move")}
                      className={cn(
                        "absolute cursor-move touch-none border",
                        isSelected
                          ? "border-primary ring-2 ring-primary/60"
                          : "border-dashed border-white/50 hover:border-primary/70",
                      )}
                      style={{
                        left: `${slot.x * 100}%`,
                        top: `${slot.y * 100}%`,
                        width: `${slot.w * 100}%`,
                        height: `${slot.h * 100}%`,
                        background: slot.plate?.color,
                      }}
                    >
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-0.5 text-[10px] font-black text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
                        {resolveSlot(slot.key, context)}
                      </span>
                      {isSelected && (
                        <span
                          onPointerDown={(e) => onPointerDown(e, slot, "resize")}
                          role="slider"
                          aria-label={`Resize ${SLOT_LABELS[slot.key]}`}
                          aria-valuenow={Math.round(slot.w * 100)}
                          tabIndex={0}
                          className={cn(
                            "absolute -bottom-1 -right-1 cursor-se-resize touch-none rounded-full border-2 border-background bg-primary",
                            HANDLE,
                          )}
                        />
                      )}
                    </div>
                  );
                })}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Drag a box onto the number it should replace. A plate sampled from the art covers
              whatever is printed underneath.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={addSlot}
                className="min-h-11 sm:min-h-0"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add slot
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={removeSelected}
                disabled={!selected}
                className="min-h-11 sm:min-h-0"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setLayout(defaultLayout(layout?.aspect ?? DEFAULT_ASPECT));
                  setSelectedId(null);
                }}
                className="min-h-11 sm:min-h-0"
              >
                Reset
              </Button>
            </div>

            {selected ? (
              <div className="space-y-2 rounded-lg border border-white/10 p-3">
                <Field label="Shows">
                  <select
                    aria-label="Value this slot shows"
                    value={selected.key}
                    onChange={(e) => patchSlot(selected.id, { key: e.target.value as StatSlotKey })}
                    className="min-h-11 w-full rounded border border-white/10 bg-transparent px-2 py-1 text-base text-foreground sm:min-h-0 sm:text-xs"
                  >
                    {SLOT_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {SLOT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Caption">
                  <input
                    aria-label="Caption above the value"
                    value={selected.label ?? ""}
                    maxLength={24}
                    placeholder="none"
                    onChange={(e) => patchSlot(selected.id, { label: e.target.value || null })}
                    className="min-h-11 w-full rounded border border-white/10 bg-transparent px-2 py-1 text-base uppercase text-foreground sm:min-h-0 sm:text-xs"
                  />
                </Field>

                <Field label={`Size ${Math.round(selected.size * 100)}%`}>
                  <input
                    aria-label="Value type size"
                    type="range"
                    min={2}
                    max={30}
                    value={Math.round(selected.size * 100)}
                    onChange={(e) => patchSlot(selected.id, { size: Number(e.target.value) / 100 })}
                    className="w-full"
                  />
                </Field>

                <Field label="Align">
                  <div className="flex overflow-hidden rounded border border-white/10">
                    {(["left", "center", "right"] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => patchSlot(selected.id, { align: a })}
                        className={cn(
                          "min-h-11 flex-1 px-2 py-1 text-[9px] font-bold uppercase tracking-widest transition-colors sm:min-h-0",
                          selected.align === a
                            ? "bg-primary/20 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Plate">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="Plate colour"
                      type="color"
                      value={hexOf(selected.plate?.color)}
                      onChange={(e) =>
                        patchSlot(selected.id, {
                          plate: { color: e.target.value, radius: selected.plate?.radius ?? 0.02 },
                        })
                      }
                      className="h-11 w-14 shrink-0 rounded border border-white/10 bg-transparent sm:h-8"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={sampleplate}
                      disabled={!artUrl}
                      className="min-h-11 sm:min-h-0"
                    >
                      <Pipette className="mr-1.5 h-3.5 w-3.5" /> Sample
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => patchSlot(selected.id, { plate: null })}
                      disabled={!selected.plate}
                      className="min-h-11 sm:min-h-0"
                    >
                      None
                    </Button>
                  </div>
                </Field>

                <Field label="Colour">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={selected.color === "tier" ? "default" : "secondary"}
                      onClick={() => patchSlot(selected.id, { color: "tier" })}
                      className="min-h-11 sm:min-h-0"
                    >
                      Tier
                    </Button>
                    <input
                      aria-label="Value colour"
                      type="color"
                      value={hexOf(selected.color === "tier" ? undefined : selected.color)}
                      onChange={(e) => patchSlot(selected.id, { color: e.target.value })}
                      className="h-11 w-14 shrink-0 rounded border border-white/10 bg-transparent sm:h-8"
                    />
                  </div>
                </Field>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-white/10 p-3 text-[11px] text-muted-foreground">
                Tap a box on the card to edit it, or add one.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => save("event")}
                disabled={busy || !layout}
                className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              >
                {busy ? "Saving…" : "Save for the event"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => save("player")}
                disabled={busy || !layout || !ep}
                className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              >
                Save for this player
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => clear("event")}
                disabled={busy || !eventLayout}
                className="min-h-11 sm:min-h-0"
              >
                Clear event layout
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => clear("player")}
                disabled={busy || !hasOwnLayout}
                className="min-h-11 sm:min-h-0"
              >
                Clear override
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {mode === "player"
                ? "This card has its own layout, so the event default does not apply to it."
                : "Showing the event layout. Saving for this player pins it to their card alone."}
            </p>
          </div>
        </div>
      )}
    </AdminSection>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A hex value for `<input type="color">`, which accepts nothing else.
 *
 * Layout colours are stored as whatever the author picked — oklch() from the
 * defaults, rgb() from the eyedropper — and none of that round-trips through a
 * colour input. The swatch falls back to a neutral rather than trying to convert;
 * picking a colour overwrites the stored value anyway.
 */
function hexOf(color: string | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#101820";
}
