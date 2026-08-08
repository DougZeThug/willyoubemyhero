import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockedCard } from "./locked-card";
import { rarityStyle } from "@/lib/card-rarity";

const BACK = {
  thumb: "https://cdn.test/back-320.webp",
  medium: "https://cdn.test/back-800.webp",
  large: "https://cdn.test/back-1200.webp",
};

function renderLocked(over: Partial<React.ComponentProps<typeof LockedCard>> = {}) {
  return render(<LockedCard back={null} name="Alice Ace" rarity={rarityStyle("base")} {...over} />);
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

  it("hides the back image from the accessibility tree", () => {
    // One image announced, not two — the back is decoration inside the slot, and
    // it is the same picture on all eighteen of them.
    renderLocked({ back: BACK });
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});
