import { forwardRef } from "react";
import { initialsOf } from "@/lib/format";
import { urlFromSet } from "@/lib/media.functions";
import type { ImageUrlSet } from "@/lib/media.functions";
import { resolveSlot, DEFAULT_ASPECT } from "@/lib/card-layout";
import type { CardLayout, SlotContext, StatSlot } from "@/lib/card-layout";

/**
 * The card itself, at print resolution, with the live numbers burnt in.
 *
 * ShareCard is the branded 1080x1350 poster with the card sitting inside a
 * frame; this is just the card, edge to edge, so what comes out is something you
 * could actually send to a printer. It is also the only way the calibrated stats
 * leave the app as pixels, which is the point: the art was frozen, and now the
 * export is the thing that freezes — at a moment you choose.
 *
 * Styles are inline and sizes are in px rather than cqw, for the same reason
 * share-card-graphic.tsx gives: html-to-image rasterises this node offscreen,
 * inline styles are the only rules that reliably survive the snapshot, and a
 * container query has no container once the node is cloned. Do not convert to
 * Tailwind, and do not reach for CardFrontPanel here — that component is built
 * for a live card in a container, this one for a fixed box.
 */

/**
 * Width of the exported card, in px.
 *
 * At the standard 2.5in x 3.5in this comes out 1050x1470, which is about 420dpi
 * — 300 would only need 750 across. The extra is deliberate headroom: it survives
 * trim on a print shop's bleed, and it means art that is not exactly 5:7 still
 * lands above 300 on its short edge.
 */
export const CARD_PRINT_WIDTH = 1050;

export type CardFrontGraphicData = {
  layout: CardLayout | null;
  context: SlotContext;
  cardUrl?: ImageUrlSet | string | null;
  photoUrl?: ImageUrlSet | string | null;
  tierColor: string;
};

export const CardFrontGraphic = forwardRef<HTMLDivElement, { data: CardFrontGraphicData }>(
  function CardFrontGraphic({ data }, ref) {
    const art = urlFromSet(data.cardUrl) ?? urlFromSet(data.photoUrl) ?? null;
    const aspect = data.layout?.aspect || DEFAULT_ASPECT;
    const width = CARD_PRINT_WIDTH;
    const height = Math.round(width / aspect);

    return (
      <div
        ref={ref}
        style={{
          width,
          height,
          position: "relative",
          overflow: "hidden",
          background: "oklch(0.16 0.02 240)",
          fontFamily: "'Barlow Condensed', system-ui, sans-serif",
        }}
      >
        {art ? (
          <img
            src={art}
            alt=""
            crossOrigin="anonymous"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: width * 0.34,
              fontWeight: 900,
              color: "rgba(255,255,255,0.15)",
            }}
          >
            {initialsOf(data.context.name)}
          </div>
        )}

        {data.layout?.slots.map((slot) => (
          <PrintSlot
            key={slot.id}
            slot={slot}
            context={data.context}
            tierColor={data.tierColor}
            cardWidth={width}
          />
        ))}
      </div>
    );
  },
);

function PrintSlot({
  slot,
  context,
  tierColor,
  cardWidth,
}: {
  slot: StatSlot;
  context: SlotContext;
  tierColor: string;
  cardWidth: number;
}) {
  const color = slot.color === "tier" ? tierColor : (slot.color ?? "oklch(0.98 0 0)");
  const items =
    slot.align === "left" ? "flex-start" : slot.align === "right" ? "flex-end" : "center";

  return (
    <div
      style={{
        position: "absolute",
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        width: `${slot.w * 100}%`,
        height: `${slot.h * 100}%`,
        display: "flex",
        flexDirection: "column",
        alignItems: items,
        justifyContent: "center",
        overflow: "hidden",
        background: slot.plate?.color,
        borderRadius: (slot.plate?.radius ?? 0) * cardWidth,
      }}
    >
      {slot.label && (
        <span
          style={{
            fontSize: slot.size * cardWidth * 0.4,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.55)",
            whiteSpace: "nowrap",
          }}
        >
          {slot.label}
        </span>
      )}
      <span
        style={{
          fontSize: slot.size * cardWidth,
          lineHeight: 1.05,
          fontWeight: 900,
          color,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {resolveSlot(slot.key, context)}
      </span>
    </div>
  );
}
