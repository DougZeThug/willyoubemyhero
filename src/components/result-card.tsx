import { forwardRef } from "react";
import { formatTime } from "@/lib/format";

export type ResultCardData = {
  eventName: string;
  eventYear?: number | null;
  participantName: string;
  fantasyTeam?: string | null;
  photoUrl?: string | null;
  totalMs: number;
  penaltyMs?: number;
  rank?: number | null;
  splits: { label: string; ms: number }[];
};

export const ResultCard = forwardRef<HTMLDivElement, { data: ResultCardData }>(
  function ResultCard({ data }, ref) {
    return (
      <div
        ref={ref}
        style={{
          width: 1080,
          height: 1350,
          background:
            "radial-gradient(circle at 50% 20%, oklch(0.28 0.06 220) 0%, oklch(0.12 0.02 240) 55%, oklch(0.08 0.015 240) 100%)",
          color: "white",
          fontFamily: "'Barlow Condensed', system-ui, sans-serif",
          padding: 72,
          display: "flex",
          flexDirection: "column",
          gap: 40,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div
              style={{
                fontSize: 22,
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
                width: 130,
                height: 130,
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

        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: 999,
              overflow: "hidden",
              background: "linear-gradient(135deg,#0e7490,#155e75)",
              display: "grid",
              placeItems: "center",
              fontSize: 90,
              fontWeight: 900,
              border: "4px solid rgba(56,189,248,0.5)",
            }}
          >
            {data.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
            <div style={{ fontSize: 84, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
              {data.participantName}
            </div>
            {data.fantasyTeam && (
              <div style={{ fontSize: 32, color: "#94a3b8", textTransform: "uppercase", marginTop: 8 }}>
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
          {data.penaltyMs && data.penaltyMs > 0 ? (
            <div style={{ fontSize: 24, color: "#fbbf24", marginTop: 8 }}>
              + {formatTime(data.penaltyMs)} penalty
            </div>
          ) : null}
        </div>

        {data.splits.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 22,
                letterSpacing: "0.4em",
                color: "#67e8f9",
                textTransform: "uppercase",
                fontWeight: 800,
                marginBottom: 16,
              }}
            >
              Station Splits
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {data.splits.map((s) => (
                <div
                  key={s.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <span style={{ fontSize: 28, textTransform: "uppercase", fontWeight: 700 }}>
                    {s.label}
                  </span>
                  <span style={{ fontSize: 32, color: "#38bdf8", fontWeight: 800 }}>
                    {formatTime(s.ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: "auto",
            fontSize: 20,
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
  },
);