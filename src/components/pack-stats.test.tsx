import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PackStats } from "./pack-stats";
import { rarityStyle } from "@/lib/card-rarity";

function renderStats(over: Partial<React.ComponentProps<typeof PackStats>> = {}) {
  return render(
    <PackStats
      packsOpened={1}
      collectedCount={3}
      rosterSize={18}
      dupes={0}
      firstPackOn="2026-07-31"
      best={null}
      {...over}
    />,
  );
}

describe("PackStats", () => {
  it("shows the honest numbers for one pack", () => {
    // The case this section was built for: one pack opened, three cards held, on
    // a device that used to claim all eighteen.
    renderStats();
    expect(screen.getByText(/1 pack opened/)).toBeInTheDocument();
    expect(screen.getByText("3/18")).toBeInTheDocument();
  });

  it("renders nothing for a member who has never ripped a pack", () => {
    // A row of zeroes is worse than no section — same reasoning as the secrets
    // line on the vault.
    const { container } = renderStats({ packsOpened: 0, collectedCount: 0, firstPackOn: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders when the packs predate the counter but cards do not", () => {
    renderStats({ packsOpened: 0, collectedCount: 2, firstPackOn: null });
    expect(screen.getByText("2/18")).toBeInTheDocument();
    expect(screen.getByText("No packs yet")).toBeInTheDocument();
  });

  it("pluralises the pack count", () => {
    renderStats({ packsOpened: 4 });
    expect(screen.getByText(/4 packs opened/)).toBeInTheDocument();
  });

  it("reads the first pack day without dragging it through a timezone", () => {
    // The value is already a league day. Parsing it as a Date would land a
    // late-evening pack on the wrong date for anyone west of the server.
    renderStats({ firstPackOn: "2026-07-31" });
    expect(screen.getByText(/since 31 Jul/)).toBeInTheDocument();
  });

  it("omits the since-line when there is no first pack", () => {
    renderStats({ firstPackOn: null });
    expect(screen.queryByText(/since/)).not.toBeInTheDocument();
  });

  it("names the rarest card held", () => {
    renderStats({ best: rarityStyle("champion") });
    expect(screen.getByText(rarityStyle("champion").label)).toBeInTheDocument();
  });

  it("dashes the best pull when nothing is held", () => {
    renderStats({ best: null, collectedCount: 0 });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("counts duplicates separately from the collection", () => {
    // Pulling a card you own moves this and not the collected count.
    renderStats({ dupes: 5 });
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3/18")).toBeInTheDocument();
  });
});
