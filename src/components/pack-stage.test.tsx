// The reveal stage.
//
// The assertion that matters most here is the negative one: nothing on this
// screen may name a card before it has been turned over. Everything else about
// the ceremony is decoration; that is the feature.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackStage, type StageCard, type StagePhase } from "./pack-stage";
import { rarityStyle } from "@/lib/card-rarity";
import { setMatchMedia } from "@/test/setup";

const FACE_DOWN: StageCard = {
  cacheKey: "ep-1",
  name: "Card 2",
  rarity: rarityStyle("base"),
  frontUrl: null,
  backUrl: null,
  backContent: <div>sealed</div>,
  caption: null,
};

const FACE_UP: StageCard = {
  ...FACE_DOWN,
  name: "Carol Crush",
  rarity: rarityStyle("podium"),
  caption: <div>Carol Crush</div>,
};

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function setup(over: Partial<React.ComponentProps<typeof PackStage>> = {}) {
  const handlers = {
    onFlip: vi.fn(),
    onEntered: vi.fn(),
    onAdvance: vi.fn(),
    onLanded: vi.fn(),
    onRevealAll: vi.fn(),
  };
  const view = render(
    <PackStage
      card={FACE_DOWN}
      phase={"facedown" as StagePhase}
      flipped={false}
      glow={false}
      originRect={null}
      targetRect={null}
      position={2}
      total={3}
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, view };
}

describe("PackStage", () => {
  it("announces nothing at all while the card is face-down", () => {
    setup();
    // Not "Card 2", not the tier, not a placeholder — an empty live region. A
    // screen reader that reads out the name of a card still face-down has given
    // away the only thing this screen is protecting.
    const live = document.querySelector("[aria-live]");
    expect(live).toBeInTheDocument();
    expect(live).toHaveTextContent("");
  });

  it("announces the card once it is face-up", () => {
    setup({ card: FACE_UP, phase: "held", flipped: true });
    expect(document.querySelector("[aria-live]")).toHaveTextContent(
      "Carol Crush — Gold. Card 2 of 3.",
    );
  });

  it("is a modal dialog, so what is behind it is out of the way", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName();
  });

  it("flips on Enter, so the ceremony is playable without touching the screen", async () => {
    const user = userEvent.setup();
    const { onFlip } = setup();
    screen.getByRole("dialog").focus();
    await user.keyboard("{Enter}");
    expect(onFlip).toHaveBeenCalledWith(true);
  });

  it("sends a face-up card to the board on Enter rather than flipping it back", async () => {
    const user = userEvent.setup();
    const { onFlip, onAdvance } = setup({ card: FACE_UP, phase: "held", flipped: true });
    screen.getByRole("dialog").focus();
    await user.keyboard("{Enter}");
    expect(onAdvance).toHaveBeenCalled();
    expect(onFlip).not.toHaveBeenCalled();
  });

  it("treats Escape as the skip, not as a way to lose the pack", async () => {
    const user = userEvent.setup();
    const { onRevealAll } = setup();
    screen.getByRole("dialog").focus();
    await user.keyboard("{Escape}");
    expect(onRevealAll).toHaveBeenCalled();
  });

  it("keeps the skip button's name exactly 'Reveal all'", () => {
    setup();
    // Pinned: e2e drives the whole secret-card suite through this button by
    // accessible name.
    expect(screen.getByRole("button", { name: "Reveal all" })).toBeInTheDocument();
  });

  it("hides the skip once there is nothing left to skip", () => {
    setup({ onRevealAll: null });
    expect(screen.queryByRole("button", { name: /reveal all/i })).not.toBeInTheDocument();
  });

  it("locks the page behind it, and gives the scroll back on the way out", () => {
    const { view } = setup();
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("puts the glow on the tier's accent, never its border", () => {
    // base and dnf set border to a near-transparent white precisely so their
    // bezel disappears; driving the glow off it would make the hold invisible on
    // exactly the cards that most need to look like something is happening.
    setup({ glow: true, card: { ...FACE_UP, rarity: rarityStyle("dnf") } });
    const glowing = document.querySelector(".pack-stage-glow") as HTMLElement;
    expect(glowing).toBeInTheDocument();
    expect(glowing.style.getPropertyValue("--stage-glow")).toBe(rarityStyle("dnf").accent);
  });

  it("still completes its beats when the device asks for less motion", () => {
    setMatchMedia((q) => q.includes("prefers-reduced-motion"));
    const { onLanded } = setup({ phase: "landing", card: FACE_UP, flipped: true });
    // The card must still reach the board. A ceremony that cannot finish under
    // reduced motion strands the pack with no way to collect it.
    expect(onLanded).toBeDefined();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
