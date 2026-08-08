// The face a roster card wears before anybody has packed it. The property that
// matters is that nothing on it identifies the card beyond the name — the whole
// point is that the art has not been spent yet.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockedCard } from "./locked-card";
import type { ImageUrlSet } from "@/lib/media";

const BACK: ImageUrlSet = {
  thumb: "https://cdn/back-320.webp",
  medium: "https://cdn/back-800.webp",
  large: "https://cdn/back-1200.webp",
};

describe("LockedCard", () => {
  it("wears the event's card back when there is one", () => {
    render(<LockedCard name="Doug Weidensaul" back={BACK} />);
    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toContain("back-");
  });

  it("falls back to the drawn back on an event with no art uploaded", () => {
    // The designed fallback, not a spinner — an event that never uploads a back
    // still looks like a pack of cards. Same contract PackCardBack has.
    render(<LockedCard name="Doug Weidensaul" back={null} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/draft combine/i)).toBeInTheDocument();
  });

  it("is named for a screen reader without claiming to be the card", () => {
    render(<LockedCard name="Doug Weidensaul" back={BACK} />);
    expect(
      screen.getByRole("img", { name: /doug weidensaul — not packed yet/i }),
    ).toBeInTheDocument();
  });

  it("renders no player art, whatever it is handed", () => {
    // The regression this component exists to prevent: the vault used to print
    // every front to anyone who scrolled past. A locked slot has exactly one
    // image in it and it is the back.
    render(<LockedCard name="Doug Weidensaul" back={BACK} />);
    const srcs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toContain("back-");
  });
});
