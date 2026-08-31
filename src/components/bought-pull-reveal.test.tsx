// The reveal is a user-dismissed full-screen dialog: it must announce itself
// as modal and own focus, or Tab falls through the overlay to the nav behind
// it — the same bug the finish-celebration accessibility sweep fixed.
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoughtPullReveal } from "./bought-pull-reveal";
import type { SecretCardView } from "@/lib/secret-cards";

vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_, tag: string) =>
        ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          createElement(tag, props, children),
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/lib/card-confetti", () => ({ celebrateSecret: vi.fn() }));
vi.mock("@/lib/card-sfx", () => ({ cue: vi.fn(), playReveal: vi.fn() }));

const card = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Test Card",
  foil: "gold",
  tier: "legendary",
  artUrl: "https://example.com/art.jpg",
  backUrl: "https://example.com/back.jpg",
} as unknown as SecretCardView;

describe("BoughtPullReveal accessibility", () => {
  it("announces itself as a modal dialog", () => {
    render(<BoughtPullReveal card={card} duplicate={false} onDone={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("is focusable and takes focus on arrival", () => {
    render(<BoughtPullReveal card={card} duplicate={false} onDone={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("tabIndex", "-1");
    expect(dialog).toHaveFocus();
  });
});
