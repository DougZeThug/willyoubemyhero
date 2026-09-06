// The one thing this app is allowed to say about cards nobody has pulled.
//
// Everything asserted here is a NEGATIVE, and that is the point: the tile may not
// count, may not link, and may not name what it is hiding. Those are easy rules to
// keep by accident today and easy to break by accident later, which is exactly the
// kind of rule that belongs in a test rather than in a comment.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MysterySlot } from "./mystery-slot";

describe("the mystery slot", () => {
  it("says there is more, and nothing about how much", () => {
    const { container } = render(<MysterySlot back={null} />);

    expect(screen.getByRole("img", { name: "Unknown cards remain" })).toBeInTheDocument();
    expect(screen.getByText("More in this set")).toBeInTheDocument();
    // No digit anywhere on the tile. A number here would be the set size written
    // out, which is the one fact the whole feature withholds.
    expect(container.textContent ?? "").not.toMatch(/\d/);
  });

  it("is not a card and cannot be opened", () => {
    // A link or a button would promise something behind it, and there is nothing
    // behind it — that is what makes it honest rather than a broken tile.
    render(<MysterySlot back={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("wears the event's own back rather than art of its own", () => {
    render(
      <MysterySlot
        back={{ thumb: "back-thumb.png", medium: "back-medium.png", large: "back-large.png" }}
      />,
    );
    // The grid rendition, like every other face-down slot on this page: a picture
    // the eye reads as "shut" does not need 1200px.
    const img = screen.getByRole("img", { name: "Unknown cards remain" }).querySelector("img");
    expect(img).toHaveAttribute("src", "back-thumb.png");
  });
});
