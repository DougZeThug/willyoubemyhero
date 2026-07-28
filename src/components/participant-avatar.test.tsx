import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParticipantAvatar } from "./participant-avatar";
import { hueOf } from "@/lib/format";

describe("ParticipantAvatar", () => {
  it("falls back to initials when there is no artwork", () => {
    render(<ParticipantAvatar name="Doug Weidensaul" />);
    expect(screen.getByText("DW")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a question mark when the name yields no initials", () => {
    render(<ParticipantAvatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("prefers the card art over the photo", () => {
    const { container } = render(
      <ParticipantAvatar
        name="Doug"
        cardUrl="https://cdn/card.webp"
        photoUrl="https://cdn/photo.jpg"
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/card.webp");
  });

  it("uses the photo when there is no card art", () => {
    const { container } = render(
      <ParticipantAvatar name="Doug" photoUrl="https://cdn/photo.jpg" />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/photo.jpg");
  });

  it("falls back to initials when both urls are null", () => {
    render(<ParticipantAvatar name="Doug Weidensaul" cardUrl={null} photoUrl={null} />);
    expect(screen.getByText("DW")).toBeInTheDocument();
  });

  it("marks the image decorative — the name is already in the surrounding row", () => {
    const { container } = render(<ParticipantAvatar name="Doug" cardUrl="https://cdn/card.webp" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("sizes itself from the size prop", () => {
    const { container } = render(<ParticipantAvatar name="Doug" size={220} />);
    expect(container.firstElementChild).toHaveStyle({ width: "220px", height: "220px" });
  });

  it("derives a stable background colour from the name", () => {
    // jsdom normalises hsl() to rgb(), so assert the property that matters:
    // the same name always paints the same, and two names do not collide.
    const background = (name: string) => {
      const { container, unmount } = render(<ParticipantAvatar name={name} />);
      const style = container.firstElementChild?.getAttribute("style") ?? "";
      unmount();
      return style;
    };
    expect(background("Doug")).toBe(background("Doug"));
    expect(background("Doug")).not.toBe(background("Alice"));
    expect(hueOf("Doug")).not.toBe(hueOf("Alice"));
  });

  it("drops the generated background once there is artwork to show", () => {
    const { container } = render(<ParticipantAvatar name="Doug" cardUrl="https://cdn/c.webp" />);
    expect(container.firstElementChild?.getAttribute("style") ?? "").not.toContain(
      "linear-gradient",
    );
  });
});
