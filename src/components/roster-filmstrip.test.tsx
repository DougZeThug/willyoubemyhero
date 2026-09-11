// The strip that moves you between cards, and the names on it.
//
// Only the no-art branch prints a name — a card with art is the card, and
// HoloCard carries its name in an sr-only line. That branch is the one a locked
// card page is made of, which is why every name in the render set clipped at
// once (§23 F7): 11px in a 64px cell has 56px of room and "Carol Crush" wants 88.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RosterFilmstrip, type FilmstripEntry } from "./roster-filmstrip";
import { rarityStyle } from "@/lib/card-rarity";

// The strip only reaches HoloCard on the branch that has art, and none of these
// assertions are about the card itself.
vi.mock("./holo-card", () => ({
  HoloCard: ({ name }: { name: string }) => <div data-testid="holo-card">{name}</div>,
}));

function entry(name: string, over: Partial<FilmstripEntry> = {}): FilmstripEntry {
  return { id: name, name, frontUrl: null, rarity: rarityStyle("base"), ...over };
}

const ENTRIES = [entry("Carol Crush"), entry("Alice Ace"), entry("Bob Blitz")];

function renderStrip(entries = ENTRIES) {
  return render(<RosterFilmstrip entries={entries} currentId={entries[0].id} onSelect={vi.fn()} />);
}

// jsdom has no scroller, and the strip keeps the current card centred in one on
// mount — the same gap the drawer tests fill for scrollIntoView.
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollTo;
});

describe("RosterFilmstrip", () => {
  it("says nothing at all with one card, because there is nowhere to go", () => {
    const { container } = renderStrip([entry("Alice Ace")]);
    expect(container).toBeEmptyDOMElement();
  });

  it("wraps a name that does not fit rather than clipping it", () => {
    renderStrip();
    const label = screen.getByText("Carol Crush");
    expect(label.className).not.toContain("truncate");
    expect(label.className).toContain("line-clamp-2");
  });

  it("keeps the whole name in the accessible name of the cell", () => {
    // Two visible lines are a fallback; the button has said the full name all
    // along and goes on saying it whichever branch drew the thumbnail.
    renderStrip();
    expect(screen.getByRole("button", { name: "Show Carol Crush" })).toBeInTheDocument();
  });

  it("prints no name at all once a card has art", () => {
    renderStrip([entry("Carol Crush", { frontUrl: "front.png" }), entry("Alice Ace")]);
    expect(screen.getByTestId("holo-card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Carol Crush" })).toBeInTheDocument();
  });
});
