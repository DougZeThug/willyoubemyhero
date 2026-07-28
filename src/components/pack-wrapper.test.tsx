// The tear gesture.
//
// Covered here rather than only in Playwright because the direction is the whole
// point and a reversed sign passes every existing test: the pack still opens, it
// just opens on the wrong gesture. There was no component test for a gesture in
// this repo before, for a good reason — see the rect stub below.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackWrapper } from "./pack-wrapper";

/** The pack, as jsdom would lay it out if jsdom laid anything out. */
const PACK = { top: 100, left: 0, width: 240, height: 320 };

beforeEach(() => {
  // jsdom has no layout engine, so every getBoundingClientRect is zeros and the
  // handler's `if (!r.height) return` bails before it can measure anything.
  // Stubbing the rect is what makes a scrub testable at all off a real browser.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...PACK,
    right: PACK.left + PACK.width,
    bottom: PACK.top + PACK.height,
    x: PACK.left,
    y: PACK.top,
    toJSON: () => ({}),
  } as DOMRect);
  // Not implemented in jsdom, and the handler calls it on every pointerdown.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function setup(props: Partial<React.ComponentProps<typeof PackWrapper>> = {}) {
  const onTear = vi.fn();
  render(
    <PackWrapper backUrl={null} cardCount={3} year={2026} seed="seed" onTear={onTear} {...props} />,
  );
  return { onTear, pack: screen.getByRole("button", { name: /swipe up to open the pack/i }) };
}

/** A pointer gesture from one fraction of the pack's height to another. */
function swipe(el: Element, fromFraction: number, toFraction: number) {
  const y = (f: number) => PACK.top + PACK.height * f;
  const opts = { pointerId: 1, bubbles: true, clientX: 120 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientY: y(fromFraction) }));
  el.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientY: y(toFraction) }));
  el.dispatchEvent(new PointerEvent("pointerup", { ...opts, clientY: y(toFraction) }));
}

describe("PackWrapper", () => {
  it("asks to be swiped up, not dragged down", () => {
    setup();
    expect(screen.getByRole("button", { name: "Swipe up to open the pack" })).toBeInTheDocument();
    expect(screen.getByText(/swipe up · or press enter/i)).toBeInTheDocument();
  });

  it("tears on a swipe that travels far enough upward", () => {
    const { onTear, pack } = setup();
    // 0.9 -> 0.15 is 75% of the height, comfortably past the 55% threshold.
    swipe(pack, 0.9, 0.15);
    expect(onTear).toHaveBeenCalledTimes(1);
  });

  it("does not tear on a swipe downward, however far it travels", () => {
    const { onTear, pack } = setup();
    swipe(pack, 0.05, 1);
    expect(onTear).not.toHaveBeenCalled();
  });

  it("does not tear on a swipe up that gives up early", () => {
    const { onTear, pack } = setup();
    // 20% of the height. Short of the threshold, so the pack springs back.
    swipe(pack, 0.9, 0.7);
    expect(onTear).not.toHaveBeenCalled();
  });

  it("measures travel from the thumb, not from the top of the pack", () => {
    // The old handler measured absolute position from the top edge, which made
    // the gesture unwinnable if you happened to start low. Starting at the very
    // bottom must work exactly as well as starting in the middle.
    const a = setup();
    swipe(a.pack, 1, 0.4);
    expect(a.onTear).toHaveBeenCalledTimes(1);
  });

  it("fires once, not once per frame past the threshold", () => {
    const { onTear, pack } = setup();
    const y = (f: number) => PACK.top + PACK.height * f;
    const opts = { pointerId: 1, bubbles: true, clientX: 120 };
    pack.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientY: y(1) }));
    for (const f of [0.3, 0.2, 0.1, 0]) {
      pack.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientY: y(f) }));
    }
    expect(onTear).toHaveBeenCalledTimes(1);
  });

  it("opens on Enter and on Space, so the gesture is never the only way in", async () => {
    const user = userEvent.setup();
    const { onTear, pack } = setup();
    pack.focus();
    await user.keyboard("{Enter}");
    expect(onTear).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onTear).toHaveBeenCalledTimes(2);
  });

  it("wears the wax foil when the event never uploaded a back", () => {
    setup({ backUrl: null });
    expect(screen.getByText(/draft combine/i)).toBeInTheDocument();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("wears the event's card back when there is one", () => {
    setup({ backUrl: "https://example.test/back.png" });
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://example.test/back.png");
    // Decorative: the pack's own aria-label already says what this is, and a
    // second announcement of "card back" on the same control is noise.
    expect(img).toHaveAttribute("alt", "");
  });
});
