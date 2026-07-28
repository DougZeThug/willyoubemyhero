import { Sparkles } from "lucide-react";

/**
 * The generic card back, for when there is no real one.
 *
 * Last link in two different fallback chains — the sealed wrapper's and a
 * face-down card's — which is why it lives in its own file rather than next to
 * either of them. HoloCard reaches it through `backContent`, only after `backUrl`
 * has come back empty.
 */
export function SealedBack() {
  return (
    <div className="wax-foil flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
      <Sparkles className="h-5 w-5 text-primary/80" />
      <div className="font-display text-[8px] font-black uppercase tracking-[0.3em] text-primary/80">
        Will YOU Be My Hero?
      </div>
      <div className="font-display text-sm font-black uppercase leading-none text-foreground/90">
        Draft Combine
      </div>
    </div>
  );
}
