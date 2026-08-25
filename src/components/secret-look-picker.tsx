// The two look controls in the secret-cards admin panel.
//
// These were native <select>s, which on a phone means the OS picker sheet: a
// list of names and nothing else. "Ultraviolet" and "Nebula" are not colours
// until you have seen them, so choosing a look meant saving, leaving the panel,
// pulling the card and coming back. Both controls now show what they are
// selling — a gradient chip per foil, a real prism ring per border effect.
//
// Each strip is a real group of <input type="radio">, hidden behind the chip it
// paints, rather than buttons wearing role="radio". Hand-rolled radio semantics
// meant thirteen Tab stops and dead arrow keys, which is a worse control than
// the select it replaced. Native inputs hand roving tabindex, arrow-key
// selection and the "3 of 13" announcement back to the browser.
import { useId } from "react";
import { Check } from "lucide-react";
import { BORDER_FX_CLASS } from "@/lib/card-rarity";
import type { BorderFx } from "@/lib/card-rarity";
import { SECRET_BORDER_FX_OPTIONS, SECRET_FOIL_OPTIONS, secretFoil } from "@/lib/secret-cards";
import { cn } from "@/lib/utils";

/** Fallbacks match the ones the selects carried: a row holding an id from a
 *  future build still highlights something rather than nothing. */
const DEFAULT_FOIL = "rosette";
const DEFAULT_BORDER_FX = "spin";

function labelFor(options: readonly { id: string; label: string }[], id: string, fallback: string) {
  return (options.find((o) => o.id === id) ?? options.find((o) => o.id === fallback))?.label ?? "";
}

/**
 * The caption + current selection line both strips share. The name still gets
 * printed — losing the dropdown must not mean losing the vocabulary people use
 * to argue about each other's cards.
 */
function PickerCaption({ caption, value }: { caption: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
      {caption}
      <span className="normal-case tracking-normal text-foreground">{value}</span>
    </span>
  );
}

/**
 * One chip: a visually hidden radio plus the swatch that stands in for it.
 *
 * sr-only rather than `hidden` or opacity-0 — the input has to stay focusable
 * and hit-testable for any of the native behaviour to survive. Every visual
 * state therefore hangs off the input via peer-*, so the chip follows the real
 * control instead of a second copy of its state.
 */
function ChipRadio({
  group,
  option,
  checked,
  onChange,
  className,
  style,
  children,
}: {
  group: string;
  option: { id: string; label: string };
  checked: boolean;
  onChange: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <label title={option.label} className="relative inline-flex cursor-pointer">
      <input
        type="radio"
        className="peer sr-only"
        name={group}
        value={option.id}
        checked={checked}
        aria-label={option.label}
        onChange={() => onChange(option.id)}
      />
      <span
        className={cn(
          "relative h-7 w-7 shrink-0 transition ring-offset-2 ring-offset-background",
          "peer-checked:ring-2 peer-checked:ring-white/80",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
          className,
        )}
        style={style}
      >
        {children}
      </span>
    </label>
  );
}

export type FoilPickerProps = {
  /** Null means "no single value" — nothing is ticked and the caption says so. */
  value: string | null;
  onChange: (id: string) => void;
  /** Card (or set) name, so two strips have distinct accessible names. */
  cardName: string;
  /** Caption shown in place of a name when `value` is null. */
  unsetLabel?: string;
  disabled?: boolean;
};

export function FoilPicker({ value, onChange, cardName, unsetLabel, disabled }: FoilPickerProps) {
  const selected =
    value == null
      ? null
      : SECRET_FOIL_OPTIONS.some((o) => o.id === value)
        ? value
        : DEFAULT_FOIL;
  // Radios group by `name`, so two cards sharing one would behave as a single
  // thirteen-way choice across both rows — picking Toxic on Zucchini would
  // silently deselect Dragon's foil.
  const group = useId();

  return (
    <div className={cn("flex flex-col gap-1", disabled && "pointer-events-none opacity-60")}>
      <PickerCaption
        caption="Foil"
        value={
          selected == null
            ? (unsetLabel ?? "Mixed")
            : labelFor(SECRET_FOIL_OPTIONS, selected, DEFAULT_FOIL)
        }
      />
      <div
        role="radiogroup"
        aria-label={`Color effect for ${cardName}`}
        className="flex flex-wrap items-center gap-1.5"
      >

        {SECRET_FOIL_OPTIONS.map((o) => {
          const rarity = secretFoil(o.id);
          const isSelected = o.id === selected;
          return (
            <ChipRadio
              key={o.id}
              group={group}
              option={o}
              checked={isSelected}
              onChange={onChange}
              className="rounded-full border"
              style={{
                // The chip is the card's own gradient endpoints, not an
                // approximation of them. Deliberately not the .holo-pattern-*
                // classes: those are colour-dodge layers built to film over
                // artwork, and with no art beneath they read as mud.
                backgroundImage: `linear-gradient(135deg, ${rarity.holoA}, ${rarity.holoB})`,
                // A real border, not an inset box-shadow: Tailwind builds `ring-*`
                // out of box-shadow, so an inline one here silently erases the
                // selected ring and the focus ring both.
                borderColor: rarity.border,
              }}
            >
              {isSelected && (
                <Check
                  className="absolute inset-0 m-auto h-3.5 w-3.5 text-black/70"
                  strokeWidth={3.5}
                  aria-hidden
                />
              )}
            </ChipRadio>
          );
        })}
      </div>
    </div>
  );
}

export type BorderFxPickerProps = {
  /** Null means "no single value" — nothing is ticked and the caption says so. */
  value: string | null;
  /** Foil id the row currently wears, so the preview rings are its colours. */
  foil: string | null;
  onChange: (id: string) => void;
  /**
   * Whether these previews may animate.
   *
   * Off by default and true only for the strip being touched. styles.css says it
   * outright above .holo-prism-edge: a grid of permanently animating compositor
   * layers is the exact cost holo-card is written to avoid, and thirteen cards ×
   * four rings is that grid. Selection is signalled by the ring and the tick,
   * never by motion, so a static strip loses nothing but the flourish.
   */
  animate?: boolean;
  cardName: string;
  /** Caption shown in place of a name when `value` is null. */
  unsetLabel?: string;
  disabled?: boolean;
};

export function BorderFxPicker({
  value,
  foil,
  onChange,
  animate,
  cardName,
  unsetLabel,
  disabled,
}: BorderFxPickerProps) {
  const selected =
    value == null
      ? null
      : SECRET_BORDER_FX_OPTIONS.some((o) => o.id === value)
        ? value
        : DEFAULT_BORDER_FX;
  const rarity = secretFoil(foil);
  const group = useId();

  return (
    <div className={cn("flex flex-col gap-1", disabled && "pointer-events-none opacity-60")}>
      <PickerCaption
        caption="Border"
        value={
          selected == null
            ? (unsetLabel ?? "Mixed")
            : labelFor(SECRET_BORDER_FX_OPTIONS, selected, DEFAULT_BORDER_FX)
        }
      />
      <div
        role="radiogroup"
        aria-label={`Border animation for ${cardName}`}
        className="flex flex-wrap items-center gap-1.5"
      >

        {SECRET_BORDER_FX_OPTIONS.map((o) => (
          <ChipRadio
            key={o.id}
            group={group}
            option={o}
            checked={o.id === selected}
            onChange={onChange}
            className="rounded-md bg-black/40"
            style={
              {
                // The same custom properties holo-card feeds the real card, so
                // the ring below is the effect itself rather than a mock-up of
                // it — and it recolours when the row's foil changes.
                "--holo-a": rarity.holoA,
                "--holo-b": rarity.holoB,
              } as React.CSSProperties
            }
          >
            <div
              className={cn("holo-prism-edge", animate && BORDER_FX_CLASS[o.id as BorderFx])}
              aria-hidden
            />
          </ChipRadio>
        ))}
      </div>
    </div>
  );
}

/**
 * The phone-sized version of the two strips above.
 *
 * Thirteen 28px chips wrap to three rows on a 360px screen, which is most of a
 * card tile spent on one control. Below `sm` the tile shows this instead: a
 * native picker (so the OS sheet does the scrolling) with the current option's
 * own swatch beside it, so the colour is still on screen even though the grid
 * of colours is not. The full strips remain, one tap away, in the edit sheet.
 */
export function CompactLookSelect({
  caption,
  value,
  options,
  fallback,
  ariaLabel,
  onChange,
  swatch,
}: {
  caption: string;
  value: string;
  options: readonly { id: string; label: string }[];
  fallback: string;
  ariaLabel: string;
  onChange: (id: string) => void;
  swatch?: React.ReactNode;
}) {
  const selected = options.some((o) => o.id === value) ? value : fallback;
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{caption}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {swatch}
        {/* text-base below sm: anything under 16px makes iOS Safari zoom the
            viewport on focus and never zoom back out. */}
        <select
          value={selected}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base text-foreground sm:min-h-0 sm:text-xs"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/** The foil strip's chip, on its own, as the swatch for the compact select. */
export function FoilSwatch({ foil }: { foil: string }) {
  const rarity = secretFoil(foil);
  return (
    <span
      aria-hidden
      className="h-7 w-7 shrink-0 rounded-full border"
      style={{
        backgroundImage: `linear-gradient(135deg, ${rarity.holoA}, ${rarity.holoB})`,
        borderColor: rarity.border,
      }}
    />
  );
}

export const FOIL_FALLBACK = DEFAULT_FOIL;
export const BORDER_FX_FALLBACK = DEFAULT_BORDER_FX;
