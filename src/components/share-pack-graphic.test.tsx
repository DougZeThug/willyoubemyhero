// The share image is the pack as it was dealt. A secret can land in any slot and
// a pack can hold two or three, so a card the graphic quietly leaves out is a card
// the person opened the pack to show.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SharePack, type SharePackCard } from "./share-pack-graphic";

const roster = (name: string): SharePackCard => ({
  id: name,
  name,
  rarityLabel: "Base",
  rarityColor: "#fff",
});
const secret = (name: string): SharePackCard => ({
  id: name,
  name,
  rarityLabel: "Secret",
  rarityColor: "#f0f",
  secret: true,
});

const draw = (cards: SharePackCard[]) =>
  render(<SharePack data={{ eventYear: 2026, cards, collected: 3, total: 13 }} />);

describe("SharePack", () => {
  it("shows a roster-only pack without a secret heading", () => {
    draw([roster("Beta"), roster("Gamma"), roster("Delta")]);
    for (const name of ["Beta", "Gamma", "Delta"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText(/one more card|secret cards/i)).toBeNull();
  });

  it("shows the one secret a pack holds", () => {
    draw([roster("Beta"), secret("Alpha"), roster("Gamma")]);
    for (const name of ["Alpha", "Beta", "Gamma"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText(/one more card/i)).toBeTruthy();
  });

  it("shows every secret when a pack holds two", () => {
    draw([secret("Alpha"), roster("Beta"), secret("Delta")]);
    for (const name of ["Alpha", "Beta", "Delta"]) expect(screen.getByText(name)).toBeTruthy();
  });

  it("shows every secret when the whole pack is secrets", () => {
    draw([secret("Alpha"), secret("Beta"), secret("Gamma")]);
    for (const name of ["Alpha", "Beta", "Gamma"]) expect(screen.getByText(name)).toBeTruthy();
  });

  // jsdom cannot measure layout, so the height budget is pinned through the
  // styles it is derived from: two lines of name, line-height 1 on the label
  // and the counter. Change one and the caption constants no longer add up.
  it("clamps a long name to two lines so it cannot push the counter off the canvas", () => {
    draw([roster("Bartholomew-Featherstonehaugh"), secret("Alpha Beta Gamma Delta"), roster("C")]);
    const name = screen.getByText("Bartholomew-Featherstonehaugh");
    expect(name.style.maxHeight).toBe(`${2 * 28 * 1.05}px`);
    expect(name.style.overflow).toBe("hidden");
    expect(name.style.overflowWrap).toBe("anywhere");
    expect(screen.getByText("Alpha Beta Gamma Delta").style.maxHeight).toBe(`${2 * 34 * 1.05}px`);
  });

  it("sets line-height 1 on the rarity labels and the counter, as the budget assumes", () => {
    draw([roster("Beta"), secret("Alpha")]);
    expect(screen.getByText("Base").style.lineHeight).toBe("1");
    expect(screen.getByText("Secret").style.lineHeight).toBe("1");
    expect(
      screen.getByText((_, el) => el?.textContent === "3 / 13" && el.children.length === 0).style
        .lineHeight,
    ).toBe("1");
  });
});
