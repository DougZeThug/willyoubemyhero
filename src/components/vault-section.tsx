import type { ReactNode } from "react";
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
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <section className="mb-3 rounded-lg border border-white/10 last:mb-0">
        {/* The move buttons are siblings of the trigger, never inside it: nested,
            every tap to reorder would also roll the shelf up or down. */}
        <div className="flex items-center pl-3 pr-1.5">
          <CollapsibleTrigger
            disabled={rearranging}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-default"
          >
            <h2
              className="truncate font-display text-[11px] font-black uppercase tracking-[0.3em]"
              style={accent ? { color: accent } : undefined}
            >
              {title}
            </h2>
            <span className="flex shrink-0 items-center gap-2">
              {meta != null && (
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
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
              />
            </span>
          </CollapsibleTrigger>
          {rearranging && (
            // A divider and real space, so the arrows read as their own control
            // group rather than as more header.
            <div className="ml-3 flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-2">
              <MoveButton label={`Move ${title} up`} enabled={canMoveUp} onMove={() => onMove(-1)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </MoveButton>
              <MoveButton label={`Move ${title} down`} enabled={canMoveDown} onMove={() => onMove(1)}>
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
        "flex h-11 w-7 shrink-0 items-center justify-center rounded transition-colors sm:h-8",
        enabled
          ? "text-muted-foreground hover:bg-white/5 hover:text-primary"
          : "text-muted-foreground/25",
      )}
    >
      {children}
    </button>
  );
}
