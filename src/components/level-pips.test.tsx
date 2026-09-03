import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelPips } from "./level-pips";
import { SECRET_TIER_ORDER, secretTierStyle } from "@/lib/secret-rarity";

/** Filled pips carry a background; unlit ones carry a border and no background. */
function filledCount(container: HTMLElement): number {
  return [...container.querySelectorAll("span[aria-hidden]")].filter(
    (el) => (el as HTMLElement).style.background !== "",
  ).length;
}

describe("LevelPips", () => {
  it.each([
    ["mythic", 5, "Mythic, 5 of 5"],
    ["legendary", 4, "Legendary, 4 of 5"],
    ["epic", 3, "Epic, 3 of 5"],
    ["rare", 2, "Rare, 2 of 5"],
    ["common", 1, "Common, 1 of 5"],
  ])("lights %s as %i pips, labelled %s", (tier, lit, label) => {
    const { container } = render(<LevelPips tier={tier} />);
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
    expect(filledCount(container)).toBe(lit);
  });

  it("always draws the whole ladder, so four filled reads as four of five", () => {
    // The unlit rungs are the information. Dropping them would make legendary
    // and mythic differ only in a count nobody can do at tile size.
    const { container } = render(<LevelPips tier="legendary" />);
    expect(container.querySelectorAll("span[aria-hidden]")).toHaveLength(SECRET_TIER_ORDER.length);
  });

  it("draws one pip for a level it does not recognise, never none", () => {
    // A row of empty diamonds reads as a card that failed to render. A corrupt
    // value has to land on the bottom rung, the way toSecretTier already does.
    const { container } = render(<LevelPips tier="__proto__" />);
    expect(screen.getByRole("img", { name: "Common, 1 of 5" })).toBeInTheDocument();
    expect(filledCount(container)).toBe(1);
  });

  it("draws one pip for a missing level", () => {
    const { container } = render(<LevelPips tier={null} />);
    expect(filledCount(container)).toBe(1);
  });

  it("colours the pips in the level's own accent", () => {
    // The pips sit under the level word and have to agree with it.
    const { container } = render(<LevelPips tier="epic" />);
    const lit = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(lit.style.background).toBe(secretTierStyle("epic").accent);
  });
});
