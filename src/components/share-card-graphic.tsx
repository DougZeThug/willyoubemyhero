import { forwardRef } from "react";
import { formatTime, initialsOf } from "@/lib/format";
import { urlFromSet } from "@/lib/media.functions";
import type { ImageUrlSet } from "@/lib/media.functions";

/**
 * 1080x1350 shareable graphic for a single player's trading card.
 *
 * Styles are inline on purpose: html-to-image rasterises this node offscreen and
 * inline styles are the only reliable way to get every rule into the snapshot.
 * Same constraint as src/components/result-card.tsx — do not convert to Tailwind.
 */

export type ShareCardData = {
  eventName: string;
  eventYear?: number | null;
  name: string;
  fantasyTeam?: string | null;
  quote?: string | null;
  rarityLabel: string;
  rarityColor: string;
  cardUrl?: ImageUrlSet | string | null;
  photoUrl?: ImageUrlSet | string | null;
  runningOrder: number;
  draftPick?: number | null;
  timeMs?: number | null;
  rank?: number | null;
};

export const ShareCard = forwardRef<HTMLDivElement, { data: ShareCardData }>(function ShareCard(
  { data },
  ref,
) {
  const art = urlFromSet(data.cardUrl) ?? urlFromSet(data.photoUrl) ?? null;
  return (
    <div
      ref={ref}
      style={{
        width: 1080,
        height: 1350,
        background:
          "radial-gradient(circle at 50% 18%, oklch(0.28 0.06 220) 0%, oklch(0.12 0.02 240) 55%, oklch(0.08 0.015 240) 100%)",
        color: "white",
        fontFamily: "'Barlow Condensed', system-ui, sans-serif",
        padding: 64,
        display: "flex",
        flexDirection: "column",
        gap: 32,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div
            style={{
              fontSize: 20,
              letterSpacing: "0.4em",
              color: "#67e8f9",
              fontWeight: 800,
              textTransform: "uppercase",
            }}
          >
            Will YOU Be My Hero?
          </div>
          <div style={{ fontSize: 48, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
            Draft Combine {data.eventYear ?? ""}
          </div>
        </div>
        <div
          style={{
            border: `2px solid ${data.rarityColor}`,
            color: data.rarityColor,
            borderRadius: 999,
            padding: "10px 24px",
            fontSize: 22,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.25em",
            whiteSpace: "nowrap",
          }}
        >
          {data.rarityLabel}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 28,
          border: `3px solid ${data.rarityColor}`,
          background: "rgba(15,23,42,0.55)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {art ? (
          <img
            src={art}
            alt=""
            crossOrigin="anonymous"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <div style={{ fontSize: 220, fontWeight: 900, color: "rgba(255,255,255,0.15)" }}>
            {initialsOf(data.name)}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 76, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
          {data.name}
        </div>
        {data.fantasyTeam && (
          <div
            style={{
              fontSize: 28,
              color: "#94a3b8",
              textTransform: "uppercase",
              marginTop: 6,
              letterSpacing: "0.1em",
            }}
          >
            {data.fantasyTeam}
          </div>
        )}
        {data.quote && (
          <div
            style={{
              fontSize: 26,
              color: "#cbd5e1",
              fontStyle: "italic",
              marginTop: 12,
              lineHeight: 1.3,
            }}
          >
            “{data.quote}”
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <ShareStat label="Order" value={`#${data.runningOrder}`} />
        <ShareStat label="Pick" value={data.draftPick != null ? `#${data.draftPick}` : "—"} />
        <ShareStat label="Time" value={data.timeMs != null ? formatTime(data.timeMs) : "—"} />
        <ShareStat label="Rank" value={data.rank != null ? `#${data.rank}` : "—"} />
      </div>

      <div
        style={{
          fontSize: 18,
          letterSpacing: "0.3em",
          color: "#64748b",
          textTransform: "uppercase",
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        {data.eventName}
      </div>
    </div>
  );
});

function ShareStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 10px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 16,
          letterSpacing: "0.3em",
          color: "#67e8f9",
          textTransform: "uppercase",
          fontWeight: 800,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 42, fontWeight: 900, color: "#38bdf8", lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}
