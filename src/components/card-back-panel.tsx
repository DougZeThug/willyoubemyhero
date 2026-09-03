import { useMemo } from "react";
import { formatTime } from "@/lib/format";
import { TIER_REASON, type Rarity } from "@/lib/card-rarity";
import { cardBadge, editionOddsLabel, type Edition } from "@/lib/card-edition";
import { cardStats, type StatsBundle } from "@/lib/card-stats";

/**
 * Generated card back, used when a player has no uploaded back artwork.
 *
 * Everything here comes from the event bundle, so the back tells you what the
 * player actually did on the course rather than repeating the front.
 *
 * Type is sized in `cqw` against the card itself, clamped at both ends. This is
 * a printed card face, not chrome: at a fixed 8px it was equally unreadable on a
 * 358px card as on a 114px pack-summary thumb, which is the §16 complaint. The
 * clamp floor keeps the thumb's ornamental size — nothing is read there — and the
 * ceiling lands the label scale (12/13px) on the card as it is actually read.
 *
 * Deliberately plain divs and CSS widths — no recharts. This renders inside a
 * `.holo-face`, which is `rotateY(180deg)` with `backface-visibility: hidden`,
 * and a ResponsiveContainer measures that node as zero-width. Charts belong on a
 * flat tab, not on a 3D-transformed face.
 */

type BackParticipant = {
  participant_id: string;
  running_order: number;
  bib_number: number | null;
  selected_draft_position: number | null;
  participant?: { name?: string | null; trash_talk_quote?: string | null } | null;
};

export function CardBackPanel({
  ep,
  bundle,
  rarity,
  edition = "standard",
}: {
  ep: BackParticipant;
  bundle: StatsBundle | null | undefined;
  rarity: Rarity;
  /** Standard prints no finish row at all. */
  edition?: Edition;
}) {
  const { bestRun, ladder } = useMemo(
    () => cardStats(bundle, ep.participant_id),
    [bundle, ep.participant_id],
  );

  const quote = ep.participant?.trash_talk_quote;
  const worst = Math.max(1, ...ladder.map((r) => r.ms ?? 0));
  const badge = cardBadge(
    { label: rarity.label, reason: TIER_REASON[rarity.tier] ?? "", accent: rarity.accent },
    edition,
  );

  return (
    <div className="@container flex h-full w-full flex-col gap-2 bg-[oklch(0.13_0.02_240)] p-3 text-left">
      {/* The headline row. On a special finish that is the metal, printed with
          the odds that produced it: TIER_REASON says what somebody did, and this
          has to say the opposite — that nobody did anything and the card came up
          this way. Quoting the rate is what makes it read as luck rather than as
          a second grade.

          accent, not border: `base` and `dnf` set border to a near-transparent
          white so their bezel vanishes, which rendered this label invisible. */}
      <div
        className="flex items-center justify-between rounded px-2 py-1"
        style={{
          border: badge.isEdition ? `2px solid ${badge.color}` : `1px solid ${rarity.border}`,
          boxShadow: badge.isEdition ? `0 0 22px -10px ${badge.color}` : undefined,
        }}
      >
        <span
          className="font-display text-[clamp(10px,4cqw,13px)] font-black uppercase tracking-[0.08em]"
          style={{ color: badge.color }}
        >
          {badge.headline}
        </span>
        <span className="text-[clamp(8px,3.75cqw,12px)] font-semibold text-muted-foreground">
          {badge.isEdition ? (editionOddsLabel(edition) ?? "") : badge.sub}
        </span>
      </div>

      {/* The demoted tier, only when the finish took the headline above. */}
      {badge.isEdition && (
        <div
          className="flex items-center justify-between rounded border px-2 py-1"
          style={{ borderColor: rarity.border }}
        >
          <span
            className="font-display text-[clamp(10px,4cqw,13px)] font-black uppercase tracking-[0.08em]"
            style={{ color: rarity.accent }}
          >
            {rarity.label}
          </span>
          <span className="text-[clamp(8px,3.75cqw,12px)] font-semibold text-muted-foreground">
            {TIER_REASON[rarity.tier] ?? ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <Vital label="Bib" value={ep.bib_number != null ? `${ep.bib_number}` : "—"} />
        <Vital label="Order" value={`#${ep.running_order}`} />
        <Vital
          label="Pick"
          value={ep.selected_draft_position != null ? `#${ep.selected_draft_position}` : "—"}
        />
      </div>

      <div className="rounded border border-white/10 bg-white/[0.03] py-1.5 text-center">
        <div className="text-[clamp(8px,3.75cqw,12px)] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Official Time
        </div>
        <div className="timer-digits tabular text-2xl text-primary">
          {bestRun ? formatTime(bestRun.official_time_ms) : "—:—"}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mb-1 text-[clamp(8px,3.75cqw,12px)] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Station Splits
        </div>
        {ladder.length === 0 ? (
          <p className="text-[clamp(8px,3.75cqw,12px)] text-muted-foreground">
            Stations not set yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {ladder.map((row) => (
              <li key={row.id} className="flex items-center gap-1.5">
                <span className="w-14 shrink-0 truncate text-[clamp(8px,3.75cqw,12px)] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {row.label}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  {row.ms != null && (
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(6, (row.ms / worst) * 100)}%` }}
                    />
                  )}
                </span>
                <span className="w-9 shrink-0 text-right text-[clamp(8px,3.75cqw,12px)] tabular text-foreground/90">
                  {row.ms != null ? formatTime(row.ms) : "—"}
                </span>
                {row.deltaMs != null && (
                  <span
                    className={
                      "w-8 shrink-0 text-right text-[clamp(8px,3.75cqw,12px)] font-bold tabular " +
                      (row.deltaMs <= 0 ? "text-primary" : "text-warn")
                    }
                  >
                    {row.deltaMs <= 0 ? "▼" : "▲"}
                    {formatTime(Math.abs(row.deltaMs))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {quote ? (
        <p className="line-clamp-2 border-t border-white/10 pt-1.5 text-[clamp(8px,3.75cqw,12px)] italic leading-snug text-muted-foreground">
          “{quote}”
        </p>
      ) : (
        <p className="border-t border-white/10 pt-1.5 text-center text-[clamp(8px,3.75cqw,12px)] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Will YOU Be My Hero?
        </p>
      )}
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] py-1 text-center">
      <div className="text-[clamp(8px,3.75cqw,12px)] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="font-display text-sm font-black text-foreground">{value}</div>
    </div>
  );
}
