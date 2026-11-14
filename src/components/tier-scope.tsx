import type { ComponentProps, CSSProperties } from "react";
import { editionStyle } from "@/lib/card-edition";
import type { Edition } from "@/lib/card-edition";

/**
 * The element a card's colours are read from.
 *
 * `CardRibbon`, `CardSlab`, `FieldComparison`, `StatTile` and the details page's
 * own washes draw in `var(--tier)` / `var(--edn)` instead of taking a colour, so
 * one pair of variables retints everything beneath. They have no default: mounted
 * outside a scope they draw in whatever the last screen left behind, so the page
 * or overlay that hosts them wraps itself in this. The tier and the finish keep
 * separate variables on purpose — two axes, never merged.
 */
export function TierScope({
  accent,
  edition,
  style,
  ...div
}: { accent: string; edition: Edition } & ComponentProps<"div">) {
  return (
    <div
      {...div}
      style={{ ...style, "--tier": accent, "--edn": editionStyle(edition).accent } as CSSProperties}
    />
  );
}
