import { forwardRef, type CSSProperties } from "react";
import { formatTime } from "@/lib/format";
import { urlFromSet } from "@/lib/media";
import {
  FOOTER_H,
  GRID_GAP,
  HEADER_H,
  HERO_H,
  RESULT_GAP,
  RESULT_H,
  RESULT_PAD,
  RESULT_W,
  shareResultLayout,
} from "@/lib/share-result-layout";
import type { ImageUrlSet } from "@/lib/media";

export type ResultCardData = {
  eventName: string;
  eventYear?: number | null;
  participantName: string;
  fantasyTeam?: string | null;
  photoUrl?: ImageUrlSet | string | null;
  totalMs: number;
  penaltyMs?: number;
  rank?: number | null;
  /** `id` is the split row's own, because a label is not unique: station names may repeat. */
  splits: { id: string; label: string; ms: number }[];
};

export const ResultCard = forwardRef<HTMLDivElement, { data: ResultCardData }>(function ResultCard(
  { data },
  ref,
) {
  const photoUrl = urlFromSet(data.photoUrl);
  const hasPenalty = !!data.penaltyMs && data.penaltyMs > 0;
  // The canvas is fixed and clips, so how the splits sit is a height budget, not
  // a style choice. Every text block below carries an explicit lineHeight because
  // that budget is exact only if "normal" is not what sets a height.
  const layout = shareResultLayout(data.splits.length, hasPenalty);
  const cell: CSSProperties = {
    boxSizing: "border-box",
    height: layout.rowH,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "0 20px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
  };
  return (
    <div
      ref={ref}
      style={{
        width: RESULT_W,
        height: RESULT_H,
        background:
          "radial-gradient(circle at 50% 20%, oklch(0.28 0.06 220) 0%, oklch(0.12 0.02 240) 55%, oklch(0.08 0.015 240) 100%)",
        color: "white",
        fontFamily: "'Barlow Condensed', system-ui, sans-serif",
        padding: RESULT_PAD,
        display: "flex",
        flexDirection: "column",
        gap: RESULT_GAP,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          height: HEADER_H,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: "0.4em",
              color: "#67e8f9",
              fontWeight: 800,
              textTransform: "uppercase",
            }}
          >
            Will YOU Be My Hero?
          </div>
          <div style={{ fontSize: 56, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
            Draft Combine {data.eventYear ?? ""}
          </div>
        </div>
        {data.rank != null && (
          <div
            style={{
              boxSizing: "border-box",
              width: HEADER_H,
              height: HEADER_H,
              flexShrink: 0,
              borderRadius: 999,
              border: "3px solid #38bdf8",
              boxShadow: "0 0 40px #38bdf8",
              display: "grid",
              placeItems: "center",
              fontSize: 60,
              fontWeight: 900,
              color: "#38bdf8",
            }}
          >
            #{data.rank}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 32, height: HERO_H }}>
        <div
          style={{
            boxSizing: "border-box",
            flexShrink: 0,
            width: HERO_H,
            height: HERO_H,
            borderRadius: 24,
            overflow: "hidden",
            background: "linear-gradient(135deg,#0e7490,#155e75)",
            display: "grid",
            placeItems: "center",
            fontSize: 90,
            fontWeight: 900,
            border: "4px solid rgba(56,189,248,0.5)",
          }}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            data.participantName
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 900,
              textTransform: "uppercase",
              lineHeight: 1,
              // Two lines and no more, so a long name cannot outgrow the 220px hero.
              // maxHeight rather than line-clamp, which the image exporter does not
              // reliably rasterise.
              maxHeight: 2 * 84,
              overflow: "hidden",
            }}
          >
            {data.participantName}
          </div>
          {data.fantasyTeam && (
            <div
              style={{
                fontSize: 32,
                lineHeight: 1.2,
                color: "#94a3b8",
                textTransform: "uppercase",
                marginTop: 8,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {data.fantasyTeam}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          borderRadius: 24,
          border: "1px solid rgba(56,189,248,0.35)",
          background: "rgba(15,23,42,0.6)",
          padding: 40,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.2,
            letterSpacing: "0.4em",
            color: "#67e8f9",
            textTransform: "uppercase",
            fontWeight: 800,
          }}
        >
          Official Time
        </div>
        <div
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 200,
            fontWeight: 900,
            color: "#38bdf8",
            letterSpacing: "-0.02em",
            lineHeight: 1,
            textShadow: "0 0 40px rgba(56,189,248,0.55)",
          }}
        >
          {formatTime(data.totalMs)}
        </div>
        {hasPenalty ? (
          <div style={{ fontSize: 24, lineHeight: 1.2, color: "#fbbf24", marginTop: 8 }}>
            + {formatTime(data.penaltyMs)} penalty
          </div>
        ) : null}
      </div>

      {data.splits.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: "0.4em",
              color: "#67e8f9",
              textTransform: "uppercase",
              fontWeight: 800,
              marginBottom: 16,
            }}
          >
            Station Splits
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
              gridAutoRows: layout.rowH,
              gap: GRID_GAP,
            }}
          >
            {data.splits.slice(0, layout.shown).map((s) => (
              <div key={s.id} style={cell}>
                <span
                  style={{
                    fontSize: layout.labelPx,
                    lineHeight: 1.2,
                    textTransform: "uppercase",
                    fontWeight: 700,
                    // Long station names give way to an ellipsis rather than
                    // pushing the time out of its cell.
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    fontSize: layout.timePx,
                    lineHeight: 1.2,
                    color: "#38bdf8",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {formatTime(s.ms)}
                </span>
              </div>
            ))}
            {layout.hidden > 0 && (
              <div style={{ ...cell, justifyContent: "center", color: "#94a3b8" }}>
                <span
                  style={{
                    fontSize: layout.labelPx,
                    lineHeight: 1.2,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  …and {layout.hidden} more
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: "auto",
          height: FOOTER_H,
          fontSize: 20,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          letterSpacing: "0.3em",
          color: "#64748b",
          textTransform: "uppercase",
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        willyoubemyhero.com · {data.eventName}
      </div>
    </div>
  );
});
