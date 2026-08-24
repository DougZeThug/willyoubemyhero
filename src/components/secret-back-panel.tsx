import { SECRET_REASON, type OwnedSecret, type SecretCardView } from "@/lib/secret-cards";
import { secretTierLabel, secretTierOddsLabel, secretTierStyle } from "@/lib/secret-rarity";
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
 *
 * `completed` is the one exception, and it is a boolean rather than a count for
 * exactly that reason: it says the set this card belongs to is FINISHED, which is
 * public the moment a trophy exists, and it still says nothing about how big any
 * set the holder is still working on might be.
 */
export function SecretBackPanel({
  card,
  rarity,
  pulledOn,
  completed = false,
  size = "small",
}: {
  card: SecretCardView | OwnedSecret;
  rarity: Rarity;
  /** ISO date of the first pull, when the caller knows it. */
  pulledOn?: string | null;
  /** Whether the holder has finished the set this card is filed in. */
  completed?: boolean;
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
        <span
          className={`font-bold uppercase tracking-[0.2em] text-muted-foreground ${large ? "text-[10px]" : "text-[8px]"}`}
        >
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
          <p
            className={`italic leading-snug text-muted-foreground ${large ? "text-sm line-clamp-5" : "text-[10px] line-clamp-4"}`}
          >
            &ldquo;{card.flavour}&rdquo;
          </p>
        ) : (
          <p className={`italic text-muted-foreground/70 ${large ? "text-sm" : "text-[10px]"}`}>
            Will YOU Be My Hero?
          </p>
        )}
      </div>

      <div className="relative flex items-center justify-between border-t border-white/10 pt-1.5">
        <span
          className={`font-bold uppercase tracking-[0.2em] ${large ? "text-[10px]" : "text-[8px]"}`}
          style={{ color: secretTierStyle(card.tier).accent }}
        >
          {/* The level of this copy and the rate that produced it — the one fact
              about a secret worth a second line on the back, exactly as the pull
              odds are for a metal finish. */}
          {secretTierLabel(card.tier)} · {secretTierOddsLabel(card.tier)}
        </span>
        {/* Takes the slot rather than sharing it: two facts in a footer this
            narrow wrap on a phone, and on a card from a finished set the set is
            the louder of the two. */}
        {completed ? (
          <span
            className={`inline-flex items-center gap-1 font-bold uppercase tracking-[0.2em] ${large ? "text-[10px]" : "text-[8px]"}`}
            style={{ color: "oklch(0.82 0.19 85)" }}
          >
            <span aria-hidden>◆</span>
            Set complete
          </span>
        ) : (
          pulledOn && (
            <span
              className={`font-bold uppercase tracking-[0.2em] text-muted-foreground ${large ? "text-[10px]" : "text-[8px]"}`}
            >
              Pulled {pulledOn}
            </span>
          )
        )}
      </div>
    </div>
  );
}
