import { hueOf, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { urlFromSet } from "@/lib/media";
import type { ImageUrlSet } from "@/lib/media";

export function ParticipantAvatar({
  name,
  photoUrl,
  cardUrl,
  size = 40,
  className,
}: {
  name: string;
  photoUrl?: ImageUrlSet | string | null;
  cardUrl?: ImageUrlSet | string | null;
  size?: number;
  className?: string;
}) {
  const hue = hueOf(name);
  const src = urlFromSet(cardUrl ?? photoUrl);
  const style = {
    width: size,
    height: size,
    background: src
      ? undefined
      : `linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 55% 32%))`,
    // Two fifths of the box is the right proportion from 28px up, and the
    // awards ballot asks for 24 — which put the initials at 9.6px, under §16's
    // 11px floor and the last sub-11px text on a player-facing screen. The
    // floor belongs here rather than at that one call site, because the next
    // caller wanting a small avatar will not remember it either.
    fontSize: Math.max(11, size * 0.4),
  } as const;
  // Decoration, in both branches. The initials repeat the name beside them on
  // every call site, and left in the accessibility tree they turn each row into
  // "BB Bob Blitz 5 spares". The photo branch has said so with alt="" since it
  // was written; the initials are the same information in a different medium.
  return (
    <div
      aria-hidden
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md border border-white/10 grid place-items-center font-display font-bold uppercase text-white/90",
        className,
      )}
      style={style}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(name) || "?"
      )}
    </div>
  );
}
