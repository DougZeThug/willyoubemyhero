// The two look controls in the secret-cards admin panel.
//
// These were native <select>s, which on a phone means the OS picker sheet: a
// list of names and nothing else. "Ultraviolet" and "Nebula" are not colours
// until you have seen them, so choosing a look meant saving, leaving the panel,
// pulling the card and coming back. Both controls now show what they are
// selling — a gradient chip per foil, a real prism ring per border effect.
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

const CHIP_BASE =
  "relative h-7 w-7 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type FoilPickerProps = {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Card name, so two rows' strips have distinct accessible names. */
  cardName: string;
};

export function FoilPicker({ value, onChange, disabled, cardName }: FoilPickerProps) {
  const selected = SECRET_FOIL_OPTIONS.some((o) => o.id === value) ? value : DEFAULT_FOIL;

  return (
    <div className="flex flex-col gap-1">
      <PickerCaption caption="Foil" value={labelFor(SECRET_FOIL_OPTIONS, selected, DEFAULT_FOIL)} />
      <div
        role="radiogroup"
        aria-label={`Color effect for ${cardName}`}
        className="flex flex-wrap items-center gap-1.5"
      >
        {SECRET_FOIL_OPTIONS.map((o) => {
          const rarity = secretFoil(o.id);
          const isSelected = o.id === selected;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={o.label}
              title={o.label}
              disabled={disabled}
              onClick={() => onChange(o.id)}
              className={cn(
                CHIP_BASE,
                "border ring-offset-2 ring-offset-background",
                isSelected && "ring-2 ring-white/80",
              )}
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type BorderFxPickerProps = {
  value: string;
  /** Foil id the row currently wears, so the preview rings are its colours. */
  foil: string;
  onChange: (id: string) => void;
  disabled?: boolean;
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
};

export function BorderFxPicker({
  value,
  foil,
  onChange,
  disabled,
  animate,
  cardName,
}: BorderFxPickerProps) {
  const selected = SECRET_BORDER_FX_OPTIONS.some((o) => o.id === value) ? value : DEFAULT_BORDER_FX;
  const rarity = secretFoil(foil);

  return (
    <div className="flex flex-col gap-1">
      <PickerCaption
        caption="Border"
        value={labelFor(SECRET_BORDER_FX_OPTIONS, selected, DEFAULT_BORDER_FX)}
      />
      <div
        role="radiogroup"
        aria-label={`Border animation for ${cardName}`}
        className="flex flex-wrap items-center gap-1.5"
      >
        {SECRET_BORDER_FX_OPTIONS.map((o) => {
          const isSelected = o.id === selected;
          const fxClass = BORDER_FX_CLASS[o.id as BorderFx];
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={o.label}
              title={o.label}
              disabled={disabled}
              onClick={() => onChange(o.id)}
              className={cn(
                CHIP_BASE,
                "rounded-md bg-black/40 ring-offset-2 ring-offset-background",
                isSelected && "ring-2 ring-white/80",
              )}
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
              <div className={cn("holo-prism-edge", animate && fxClass)} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}
