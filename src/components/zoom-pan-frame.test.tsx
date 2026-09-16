import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ZoomPanFrame } from "./zoom-pan-frame";

/**
 * The frame's touch-action is not styling: it decides whether the page can be
 * scrolled from the card, which is most of a phone screen. A hero card that
 * claimed both axes on a scrolling page left the page unscrollable through it.
 */
describe("ZoomPanFrame touch-action", () => {
  const frameOf = () => screen.getByTestId("child").parentElement!.parentElement!;

  it("gives the vertical axis to the page at 1x when the page scrolls", () => {
    render(
      <ZoomPanFrame allowPageScroll>{() => <div data-testid="child">card</div>}</ZoomPanFrame>,
    );
    expect(frameOf().style.touchAction).toBe("pan-y");
  });

  it("claims the whole gesture in a full-screen viewer", () => {
    render(<ZoomPanFrame>{() => <div data-testid="child">card</div>}</ZoomPanFrame>);
    expect(frameOf().style.touchAction).toBe("none");
  });
});
