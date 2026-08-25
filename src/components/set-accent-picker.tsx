import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SET_ACCENTS, setAccentColor } from "@/lib/secret-cards";
import { cn } from "@/lib/utils";

/**
 * The set's colour, collapsed to a single dot.
 *
 * The palette is twenty swatches now, and inline that was two wrapped rows per
 * set — the Sets list stopped being scannable long before the list of sets got
 * long. The trigger is small because it sits in a crowded row; the swatches
 * inside the popover are deliberately not, since this is used one-handed.
 */
export function SetAccentPicker({
  accent,
  setLabel,
  disabled,
  onPick,
}: {
  accent: string | null | undefined;
  setLabel: string;
  disabled?: boolean;
  /** null clears the theme. */
  onPick: (accentId: string | null, accentLabel: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = setAccentColor(accent);

  const choose = (id: string | null, label: string) => {
    setOpen(false);
    onPick(id, label);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Colour for ${setLabel}`}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 disabled:opacity-30",
          )}
        >
          <span
            className={cn(
              "h-4 w-4 rounded-full border",
              current ? "border-white/40" : "border-dashed border-white/40",
            )}
            style={current ? { background: current } : undefined}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[min(18rem,90vw)] p-2">
        <div className="grid grid-cols-6 gap-1.5">
          <button
            type="button"
            onClick={() => choose(null, "untinted")}
            aria-label={`No colour for ${setLabel}`}
            aria-pressed={!accent}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border text-[10px] text-muted-foreground",
              !accent ? "border-primary ring-2 ring-primary/50" : "border-white/20",
            )}
          >
            ✕
          </button>
          {SET_ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => choose(a.id, a.label)}
              aria-label={`${a.label} for ${setLabel}`}
              aria-pressed={accent === a.id}
              className={cn(
                "h-7 w-7 rounded-full border transition-transform",
                accent === a.id
                  ? "scale-110 border-white/60 ring-2 ring-white/40"
                  : "border-white/15",
              )}
              style={{ background: a.oklch }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
