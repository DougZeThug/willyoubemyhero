import { SECRET_REASON, type OwnedSecret, type SecretCardView } from "@/lib/secret-cards";
import type { Rarity } from "@/lib/card-rarity";

/**
 * Generated back for a secret card.
 *
 * A sibling of CardBackPanel so the two feel like one deck, but the split ladder's
 * real estate goes to the one line the commissioner wrote — and the emptiness is
 * the signal. A secret is the only card in the app with a name you don't
 * recognise and no stats on the back, which says "this is different" better than
 * any gradient does.
 *
 * No serial and no set size. "3 of 12" printed here would give away in one glance
 * the exact thing the rest of the feature goes to some length to withhold.
 */
export function SecretBackPanel({
  card,
  rarity,
  pulledOn,
  size = "small",
}: {
  card: SecretCardView | OwnedSecret;
  rarity: Rarity;
  /** ISO date of the first pull, when the caller knows it. */
  pulledOn?: string | null;
  /** Large renders bigger text for the full-sheet view. */
  size?: "small" | "large";
}) {
  const large = size === "large";
  return (
    <div className="relative flex h-full w-full flex-col gap-2 overflow-hidden bg-[oklch(0.13_0.02_240)] p-3 text-left">
      {/* A rosette ghosted behind the text, so the panel reads as printed rather
          than as a card whose stats failed to load. Static: this sits on a
          rotateY(180deg) face and never gets a pointer, so there is nothing for a
          moving version to track. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          background: `repeating-conic-gradient(from 0deg at 50% 42%, transparent 0deg 12deg, ${rarity.holoA} 16deg, ${rarity.holoB} 20deg, transparent 24deg 36deg)`,
          maskImage: "radial-gradient(circle at 50% 42%, black 0%, black 22%, transparent 55%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 42%, black 0%, black 22%, transparent 55%)",
        }}
      />

      <div
        className="relative flex items-center justify-between rounded border px-2 py-1"
        style={{ borderColor: rarity.border }}
      >
        <span
          className={`font-display font-black uppercase tracking-[0.25em] ${large ? "text-xs" : "text-[10px]"}`}
          style={{ color: rarity.accent }}
        >
          {rarity.label}
        </span>
        {/* Hardcoded, never TIER_REASON[rarity.tier] — SECRET_RARITY carries
            tier: "base" to satisfy the type, and that lookup would print
            "Combine athlete" on a card that was never at the combine. */}
        <span className={`font-bold uppercase tracking-[0.2em] text-muted-foreground ${large ? "text-[10px]" : "text-[8px]"}`}>
          {SECRET_REASON}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div
          className={`font-display font-black uppercase leading-tight text-foreground/95 ${large ? "text-xl" : "text-base"}`}
        >
          {card.name}
        </div>
        {card.flavour ? (
          <p className={`italic leading-snug text-muted-foreground ${large ? "text-sm line-clamp-5" : "text-[10px] line-clamp-4"}`}>
            &ldquo;{card.flavour}&rdquo;
          </p>
        ) : (
          <p className={`italic text-muted-foreground/70 ${large ? "text-sm" : "text-[10px]"}`}>Will YOU Be My Hero?</p>
        )}
      </div>

      <div className="relative flex items-center justify-between border-t border-white/10 pt-1.5">
        <span className={`font-bold uppercase tracking-[0.2em] text-muted-foreground ${large ? "text-[10px]" : "text-[8px]"}`}>
          Secret
        </span>
        {pulledOn && (
          <span className={`font-bold uppercase tracking-[0.2em] text-muted-foreground ${large ? "text-[10px]" : "text-[8px]"}`}>
            Pulled {pulledOn}
          </span>
        )}
      </div>
    </div>
  );
}
