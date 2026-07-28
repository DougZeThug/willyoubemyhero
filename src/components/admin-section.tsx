import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A titled admin panel that collapses on phones and stays open on desktop.
 *
 * The console stacks five of these, and on a phone five fixed-height scroll
 * boxes inside a scrolling page traps touch scrolling. Collapsing them means
 * one scroll surface and a page you can thumb through.
 *
 * Open state is CSS-only rather than `useIsMobile()`: that hook reports false
 * during SSR and flips after mount, which would collapse every section for a
 * frame on desktop. `forceMount` keeps the body in the DOM so
 * `max-md:data-[state=closed]:hidden` can hide it below `md` and nowhere else.
 */
export function AdminSection({
  icon,
  title,
  meta,
  defaultOpen = false,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Small right-aligned counter, e.g. "3/12 claimed". */
  meta?: ReactNode;
  /** Applies on phones only — desktop always renders expanded. */
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={cn("hud-bezel border-primary/20", className)}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardContent className="p-4 sm:p-5">
          <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 text-left md:pointer-events-none md:min-h-0">
            <span className="flex min-w-0 items-center gap-2 text-primary">
              {icon}
              <h2 className="truncate font-display text-sm font-black uppercase tracking-[0.3em]">
                {title}
              </h2>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {meta && (
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {meta}
                </span>
              )}
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-primary/70 transition-transform md:hidden",
                  open && "rotate-180",
                )}
              />
            </span>
          </CollapsibleTrigger>

          <CollapsibleContent forceMount className="mt-3 max-md:data-[state=closed]:hidden">
            {children}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
