import { hueOf, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ParticipantAvatar({
  name,
  photoUrl,
  cardUrl,
  size = 40,
  className,
}: {
  name: string;
  photoUrl?: string | null;
  cardUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const hue = hueOf(name);
  const src = cardUrl ?? photoUrl ?? null;
  const style = {
    width: size,
    height: size,
    background: src
      ? undefined
      : `linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 55% 32%))`,
    fontSize: size * 0.4,
  } as const;
  return (
    <div
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
