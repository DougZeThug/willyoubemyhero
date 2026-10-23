import { forwardRef } from "react";
import { initialsOf } from "@/lib/format";
import { urlFromSet } from "@/lib/media";
import { sharePackLayout, SHARE_H, SHARE_W } from "@/lib/share-pack-layout";
import type { ImageUrlSet } from "@/lib/media";

/**
 * 1080x1350 shareable graphic for a whole pack.
 *
 * Styles are inline on purpose: html-to-image rasterises this node offscreen and
 * inline styles are the only rules reliably captured. Same constraint as
 * share-card-graphic.tsx and result-card.tsx — do not convert to Tailwind. It
 * fails silently, producing an unstyled PNG rather than an error.
 *
 * A pack, not a card. The per-card export already exists and is the right thing
 * for showing off one pull; this is the thing you put in the group chat to say
 * what you opened, so every card is in it and the secrets are printed bigger.
 */

export type SharePackCard = {
  /** The dealt slot's own id, which is what keys the row: names and positions are not identity. */
  id: string;
  name: string;
  rarityLabel: string;
  rarityColor: string;
  artUrl?: ImageUrlSet | string | null;
  /** A secret, which is printed larger and on its own row. A pack can hold several. */
  secret?: boolean;
};

export type SharePackData = {
  eventYear?: number | null;
  cards: SharePackCard[];
  /** How much of the roster this person has, after the pack. */
  collected: number;
  total: number;
};

/** One card in the row, sized by the caller so the secret can be bigger. */
function Slot({ card, width }: { card: SharePackCard; width: number }) {
  const art = urlFromSet(card.artUrl);
  const nameSize = card.secret ? 34 : 28;
  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          width,
          // Standard 2.5 x 3.5, so the exported image shows the same proportions
          // the app does.
          height: width * 1.4,
          borderRadius: 18,
          border: `3px solid ${card.rarityColor}`,
          background: "rgba(15,23,42,0.55)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {art ? (
          <img
            src={art}
            alt=""
            crossOrigin="anonymous"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ fontSize: width * 0.4, fontWeight: 900, color: "rgba(255,255,255,0.15)" }}>
            {initialsOf(card.name)}
          </div>
        )}
      </div>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: nameSize,
            fontWeight: 900,
            textTransform: "uppercase",
            lineHeight: 1.05,
            // Two lines and no more: the caption budget in share-pack-layout is
            // for two, and a third would push the counter off the clipped canvas.
            // maxHeight rather than line-clamp, which the image exporter does not
            // reliably rasterise.
            maxHeight: 2 * nameSize * 1.05,
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        >
          {card.name}
        </div>
        <div
          style={{
            fontSize: card.secret ? 20 : 17,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            color: card.rarityColor,
            lineHeight: 1,
            marginTop: 4,
          }}
        >
          {card.rarityLabel}
        </div>
      </div>
    </div>
  );
}

export const SharePack = forwardRef<HTMLDivElement, { data: SharePackData }>(function SharePack(
  { data },
  ref,
) {
  const roster = data.cards.filter((c) => !c.secret);
  // Every one of them, not the first: a pack is dealt from one pool and can hold
  // two or three secrets, and the image is for showing off what was opened.
  const secrets = data.cards.filter((c) => c.secret);
  // Solved against the canvas rather than chosen, because the canvas is fixed and
  // its root clips: a pack with a secret in it has two card rows to fit into one
  // height, so the roster row has to give up the room the secrets take. Sized for
  // three and then given a secret 34% wider underneath, this overflowed by about
  // 170px and cut the collection counter off the bottom of the image.
  const size = sharePackLayout(roster.length, secrets.length);

  return (
    <div
      ref={ref}
      style={{
        width: SHARE_W,
        height: SHARE_H,
        background:
          "radial-gradient(circle at 50% 18%, oklch(0.28 0.06 220) 0%, oklch(0.12 0.02 240) 55%, oklch(0.08 0.015 240) 100%)",
        color: "white",
        fontFamily: "'Barlow Condensed', system-ui, sans-serif",
        padding: 64,
        display: "flex",
        flexDirection: "column",
        gap: 28,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ textAlign: "center" }}>
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
        <div style={{ fontSize: 62, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
          Today&apos;s Pack {data.eventYear ?? ""}
        </div>
      </div>

      {/* Left out when empty: an all-secret pack has no roster, and an empty row
          would still cost a flex gap the layout did not budget for. */}
      {roster.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 28 }}>
          {roster.map((card) => (
            <Slot key={card.id} card={card} width={size.roster} />
          ))}
        </div>
      )}

      {secrets.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            marginTop: 4,
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.35em",
              color: secrets[0].rarityColor,
            }}
          >
            {secrets.length === 1 ? "One More Card" : "Secret Cards"}
          </div>
          {/* Bigger than the roster cards where there is room, which is the whole
              point of them. */}
          <div style={{ display: "flex", justifyContent: "center", gap: 28 }}>
            {secrets.map((card) => (
              <Slot key={card.id} card={card} width={size.secret} />
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "2px solid rgba(103,232,249,0.25)",
          paddingTop: 22,
        }}
      >
        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.25em",
            color: "#94a3b8",
          }}
        >
          Collected
        </div>
        <div style={{ fontSize: 44, fontWeight: 900, color: "#67e8f9", lineHeight: 1 }}>
          {data.collected} / {data.total}
        </div>
      </div>
    </div>
  );
});
