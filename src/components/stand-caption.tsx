import { motion } from "motion/react";
import { LevelPips } from "@/components/level-pips";
import type { StandParticipant } from "@/lib/stand-view";
import { cardBadge, type Edition } from "@/lib/card-edition";
import { packedByLabel } from "@/lib/card-pulls";
import type { Rarity } from "@/lib/card-rarity";
import type { SecretCardView } from "@/lib/secret-cards";
import { secretTierCaption, secretTierStyle } from "@/lib/secret-rarity";

/**
 * What the stand says under a card once it is face up.
 *
 * The caller decides whether there is anything to say (a revealed card on the
 * mark) and wraps this in the AnimatePresence, so the guard and the exit stay
 * where the rest of the stand's mounting does.
 */
export function StandCaption({
  name,
  onSecret,
  secret,
  isDupe,
  rarity,
  edition,
  ep,
  pullCounts,
  sellValue,
}: {
  name: string;
  onSecret: boolean;
  secret: SecretCardView | null;
  isDupe: boolean;
  rarity: Rarity;
  edition: Edition | null;
  ep: StandParticipant | null;
  pullCounts: Record<string, number> | undefined;
  /** What a spare copy would fetch, or null for nothing to say. */
  sellValue: number | null;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
        {name}
      </div>
      {onSecret ? (
        <>
          {/* The pips ride even on a duplicate: the copy in front of
              you still rolled a level, and hiding it here would make
              the one moment the level is decided the one place it is
              not shown.

              `namesLevel` follows the caption below, which is the only
              other thing here that says the level out loud — and on a
              plain duplicate it is replaced by a line that never names
              it. Without this the pips would announce "Level 5 of 5"
              and a screen reader would never hear "Mythic" at all. */}
          <LevelPips tier={secret?.tier} namesLevel={isDupe} className="mt-0.5" />
          <div
            className="text-label font-bold uppercase tracking-[0.08em]"
            style={{ color: isDupe ? undefined : secretTierStyle(secret?.tier).accent }}
          >
            {/* An upgrade keeps the level line: the level is the news. */}
            {isDupe
              ? "Already yours — this one's just showing off"
              : secretTierCaption(secret?.tier)}
          </div>
          {/* The point of the dupe economy, said at the only moment it
              lands: the sting is now something worth selling. WORTH,
              not paid — nothing is credited on a pull any more, so
              "+N dust" here would be a lie. */}
          {sellValue ? (
            <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
              Sell for {sellValue}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* A special finish takes this line in its own metal and the
              tier drops to the muted one beneath — see cardBadge.
              Nothing extra on a standard finish, which is seven pulls
              in ten. */}
          {(() => {
            const badge = cardBadge(
              { label: rarity.label, reason: "", accent: rarity.accent },
              edition,
            );
            return (
              <div
                className="truncate text-meta font-semibold uppercase tracking-[0.08em]"
                style={{ color: badge.color }}
              >
                {badge.headline}
              </div>
            );
          })()}
          {ep && packedByLabel(pullCounts?.[ep.id]) && (
            <div className="text-meta font-semibold text-muted-foreground">
              {packedByLabel(pullCounts?.[ep.id])}
            </div>
          )}
          {/* The same offer a duplicate secret gets, in the same words,
              because it is the same ledger. The route only prices a
              card when it is a spare and dust is on, so reaching it at
              all is the decision. */}
          {sellValue ? (
            <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
              Sell for {sellValue}
            </div>
          ) : null}
        </>
      )}
    </motion.div>
  );
}
