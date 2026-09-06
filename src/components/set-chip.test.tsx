// The set travelling with the card, and the two things it must never turn into:
// a size, or a label on something that has no set.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetChip } from "./set-chip";
import { SECRET_RARITY } from "@/lib/secret-cards";

const SETS = [
  { id: "pets", label: "Pets", accent: "mint" },
  { id: "wags", label: "WAGs", accent: null },
];

describe("the set chip", () => {
  it("names the set in the colour the commissioner gave it", () => {
    render(<SetChip collection="pets" sets={SETS} />);
    expect(screen.getByText("Pets")).toHaveStyle({ color: "oklch(0.86 0.13 165)" });
  });

  it("falls back to the shared secret green for an untinted set", () => {
    // The shelf header's own fallback, so a card and the panel it sits in agree.
    render(<SetChip collection="wags" sets={SETS} />);
    expect(screen.getByText("WAGs")).toHaveStyle({ color: SECRET_RARITY.accent });
  });

  it("uses the shipped labels while the list is still in the air", () => {
    // `sets` undefined is "not answered yet", not "there are no sets" — so the
    // four that shipped stand in rather than a card wearing its raw id.
    render(<SetChip collection="pets" />);
    expect(screen.getByText("Pets")).toBeInTheDocument();
  });

  it("keeps a retired set legible rather than dropping it", () => {
    // An id nobody has a label for still has rows pointing at it, and a card that
    // silently loses its set reads as a bug.
    render(<SetChip collection="badgers" sets={SETS} />);
    expect(screen.getByText("badgers")).toBeInTheDocument();
  });

  it("says nothing at all about an unfiled card", () => {
    // "Secrets" is the heading over a pile, not the name of a set, and a chip
    // saying so would dress a shelf label up as something the card belongs to.
    const { container } = render(<SetChip collection={null} sets={SETS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("never carries a number", () => {
    // The rule the whole feature is built on. A set name is public; a set size
    // is the one fact withheld everywhere but a completion trophy.
    const { container } = render(<SetChip collection="pets" sets={SETS} />);
    expect(container.textContent ?? "").not.toMatch(/\d/);
  });
});
