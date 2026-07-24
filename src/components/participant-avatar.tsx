import { hueOf, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ParticipantAvatar({
  name,
  photoUrl,
  size = 40,
  className,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const hue = hueOf(name);
  const style = {
    width: size,
    height: size,
    background: photoUrl
      ? undefined
      : `linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 55% 32%))`,
    fontSize: size * 0.4,
  } as const;
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border border-white/10 grid place-items-center font-display font-bold uppercase text-white/90",
        className,
      )}
      style={style}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(name) || "?"
      )}
    </div>
  );
}