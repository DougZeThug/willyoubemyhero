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
});
