import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * One rolled-up shelf on the vault, with the controls to move it.
 *
 * A sibling to AdminSection rather than a setting on it. That component is
 * deliberately open-on-desktop — `md:pointer-events-none` on the trigger and
 * `forceMount` so CSS alone can hide the body below `md` — because five admin
 * panels only trap scrolling on a phone. Here the whole point is a page you can
 * skim at any width, so this one closes everywhere, and no `forceMount`: a shut
 * shelf drops its HoloCards, and each of those is running a tilt.
 */
export function VaultSection({
  title,
  meta,
  accent,
  open,
  onOpenChange,
  canMoveUp,
  canMoveDown,
  onMove,
  rearranging = false,
  action,
  children,
}: {
  title: string;
  /** Small right-aligned count, e.g. how many of this set you hold. */
  meta?: ReactNode;
  /**
   * Header colour. The secret shelves pass SECRET_RARITY.accent, which is what
   * marks them as not-roster-cards now that they sit as the roster's peers.
   */
  accent?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  /**
   * Reorder mode. The move arrows only exist while it is on, and the header
   * stops toggling — two targets a thumb-width apart is the mistap this mode
   * exists to remove.
   */
  rearranging?: boolean;
  /**
   * One control belonging to this shelf, drawn in its header.
   *
   * The roster's "Sort & filter" chip, and only ever a sibling of the trigger —
   * nested, every tap on it would roll the shelf up as well, which is the same
   * lesson the move buttons below learned.
   */
  action?: ReactNode;
  children: ReactNode;
}) {
  // A themed shelf is a lit panel rather than a hairline box: one even fill of
  // the set's colour behind the cards, a border in the same colour, and while it
  // is open an inner ring in that colour rather than an outer bloom. The bloom
  // was one of the glows competing with the foil on this exact screen (§15), and
  // a ring says "this one is open" without spilling light onto the cards.
  const themed = !!accent;
  const style = accent
    ? ({
        "--set-accent": accent,
        background: `color-mix(in oklab, ${accent} 10%, var(--card))`,
        borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
        boxShadow: open
          ? `inset 0 0 0 2px color-mix(in oklab, ${accent} 45%, transparent), inset 0 1px 0 oklch(1 0 0 / 6%)`
          : "inset 0 1px 0 oklch(1 0 0 / 6%)",
      } as CSSProperties)
    : undefined;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <section
        className={cn(
          "mb-3 rounded-xl border last:mb-0 transition-shadow",
          // An untinted shelf — the roster, favourites, trophies — is the plain
          // surface every other panel on a card screen now uses.
          themed ? "border" : "surface-panel",
        )}
        style={style}
      >
        {/* The move buttons are siblings of the trigger, never inside it: nested,
            every tap to reorder would also roll the shelf up or down. */}
        <div className="flex items-center pl-3 pr-1.5">
          <CollapsibleTrigger
            disabled={rearranging}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-default"
          >
            <h2
              className="truncate font-display text-badge font-black uppercase tracking-[0.08em]"
              style={accent ? { color: accent } : undefined}
            >
              {title}
            </h2>
            <span className="flex shrink-0 items-center gap-2">
              {meta != null && (
                <span
                  className="text-meta text-muted-foreground"
                  style={accent ? { color: accent, opacity: 0.8 } : undefined}
                >
                  {meta}
                </span>
              )}
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-primary/70 transition-transform",
                  open && "rotate-180",
                  rearranging && "opacity-30",
                )}
                style={accent ? { color: accent } : undefined}
              />
            </span>
          </CollapsibleTrigger>

          {action}

          {rearranging && (
            // A divider and real space, so the arrows read as their own control
            // group rather than as more header.
            <div className="ml-3 flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-2">
              <MoveButton label={`Move ${title} up`} enabled={canMoveUp} onMove={() => onMove(-1)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </MoveButton>
              <MoveButton
                label={`Move ${title} down`}
                enabled={canMoveDown}
                onMove={() => onMove(1)}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </MoveButton>
            </div>
          )}
        </div>
        <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function MoveButton({
  label,
  enabled,
  onMove,
  children,
}: {
  label: string;
  enabled: boolean;
  onMove: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // aria-disabled and a dead handler rather than `disabled`. A real disabled
      // lands on the button the moment its section reaches an end — which is the
      // button you just pressed — and a disabled button hands focus back to
      // <body>, so a keyboard user loses their place mid-rearrange.
      aria-disabled={enabled ? undefined : true}
      onClick={() => enabled && onMove()}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded transition-colors sm:h-8 sm:w-8",
        enabled
          ? "text-muted-foreground hover:bg-white/5 hover:text-primary"
          : "text-muted-foreground/25",
      )}
    >
      {children}
    </button>
  );
}
