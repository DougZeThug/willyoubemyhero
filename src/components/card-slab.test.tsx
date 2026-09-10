// The acrylic case, and the one line on its plate that is not a number.
//
// The plate is a three-part row with a shrink-0 mark on one side and a shrink-0
// serial on the other, so the event's own name gets whatever is left — about
// 114px at 320, against the 135 "Draft Combine 2026" wants. It truncated, and an
// event whose name did not fit was an event with no name (§23 F8).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardSlab } from "./card-slab";
import type { CollectedCard } from "@/lib/card-collection";

const collected: CollectedCard = {
  eventParticipantId: "ep-alice",
  pulledAt: Date.UTC(2026, 7, 1),
  count: 3,
  tier: "podium",
  edition: "gold",
};

function renderSlab(over: Partial<React.ComponentProps<typeof CardSlab>> = {}) {
  return render(
    <CardSlab
      eventName="Draft Combine"
      eventYear={2026}
      serial={3}
      ofTotal={13}
      collected={collected}
      {...over}
    >
      <div>card</div>
    </CardSlab>,
  );
}

describe("CardSlab", () => {
  it("wraps the event line rather than clipping it", () => {
    renderSlab();
    const title = screen.getByText("Draft Combine 2026");
    expect(title.className).not.toContain("truncate");
    expect(title.className).toContain("line-clamp-2");
  });

  it("prints the year only when the name does not already carry it", () => {
    renderSlab({ eventName: "Will YOU Be My Hero 2026" });
    expect(screen.getByText("Will YOU Be My Hero 2026")).toBeInTheDocument();
  });

  it("keeps the serial beside the event rather than under it", () => {
    renderSlab();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("/13")).toBeInTheDocument();
  });

  it("says nothing about your copy on a card you have never pulled", () => {
    renderSlab({ collected: null });
    expect(screen.queryByText(/pulled ×/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/collected/i)).not.toBeInTheDocument();
  });
});
