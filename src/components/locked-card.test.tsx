import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockedCard, LOCKED_EDITION, LOCKED_RARITY } from "./locked-card";

const BACK = {
  thumb: "https://cdn.test/back-320.webp",
  medium: "https://cdn.test/back-800.webp",
  large: "https://cdn.test/back-1200.webp",
};

function renderLocked(over: Partial<React.ComponentProps<typeof LockedCard>> = {}) {
  return render(<LockedCard back={null} name="Alice Ace" {...over} />);
}

describe("LockedCard", () => {
  it("wears the event's card back when there is one", () => {
    const { container } = renderLocked({ back: BACK });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(BACK.large);
  });

  it("falls back to the drawn back on an event with no uploaded one", () => {
    // The designed fallback, not a spinner: an event that never uploads a back
    // gets this permanently and the vault still looks like a pack of cards.
    const { container } = renderLocked();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/draft combine/i)).toBeInTheDocument();
  });

  it("names the player behind the slot, and says it is shut", () => {
    // The whole accessible content of the slot: which card this is, and that it
    // has not been packed. Nothing about the art, the tier or the time.
    renderLocked({ back: BACK });
    expect(screen.getByRole("img", { name: "Alice Ace — not packed yet" })).toBeInTheDocument();
  });

  it("wears the neutral bezel rather than the tier it is hiding", () => {
    // Owned by the component, not passed in: the tier is the thing being
    // withheld, so there is no prop through which a champion's gold could reach
    // the bezel of the card hiding one.
    expect(LOCKED_RARITY.tier).toBe("base");
    renderLocked({ back: BACK });
    const slot = screen.getByRole("img", { name: /not packed yet/i });
    expect(slot).toHaveStyle({ borderColor: LOCKED_RARITY.border });
  });

  it("wears no finish either, and has no prop to be given one", () => {
    // Stronger than the tier case above: a tier can at least be reasoned about
    // from the leaderboard, so leaking one spoils a card. A finish is pure luck
    // and knowable from nowhere else, so a platinum frame on a slot would give
    // away the best thing about a pull before the pack is even torn.
    // There is no edition prop on LockedCard to override — that half is the
    // compiler's job, and this constant is what the *other* surfaces dressing a
    // locked card have to reach for instead.
    expect(LOCKED_EDITION).toBe("standard");
    const { container } = renderLocked({ back: BACK });
    expect(container.querySelector('[class*="card-edition"]')).toBeNull();
  });

  it("hides the back image from the accessibility tree", () => {
    // One image announced, not two — the back is decoration inside the slot, and
    // it is the same picture on all eighteen of them.
    renderLocked({ back: BACK });
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});
