import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultSection } from "./vault-section";

function renderSection(over: Partial<React.ComponentProps<typeof VaultSection>> = {}) {
  const props: React.ComponentProps<typeof VaultSection> = {
    title: "Cornhole Collection",
    open: true,
    onOpenChange: vi.fn(),
    canMoveUp: true,
    canMoveDown: true,
    onMove: vi.fn(),
    // Most cases here are about the move buttons, which only exist in reorder
    // mode; the two cases below cover the default, where they do not.
    rearranging: true,
    children: <p>Gary the Grill</p>,
    ...over,
  };
  return { props, ...render(<VaultSection {...props} />) };
}

describe("VaultSection", () => {
  it("heads the shelf with its name and what is on it", () => {
    renderSection({ meta: 4 });
    expect(screen.getByRole("heading", { name: "Cornhole Collection" })).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("drops its contents when it is rolled up", () => {
    // Not hidden — gone. Every tile in here runs a tilt, and a phone holding four
    // shut shelves in the DOM is paying for all of them.
    renderSection({ open: false });
    expect(screen.queryByText("Gary the Grill")).not.toBeInTheDocument();
  });

  it("rolls up when the header is tapped", async () => {
    const { props } = renderSection({ rearranging: false });
    // The exact name, not a pattern: the two move buttons carry the shelf's name
    // in their labels too, and a loose match finds all three.
    await userEvent.click(screen.getByRole("button", { name: "Cornhole Collection" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the move buttons until the vault is being rearranged", () => {
    // Two targets a thumb-width apart is the mistap this mode removes: with it
    // off the header row is collapse and nothing else.
    renderSection({ rearranging: false });
    expect(
      screen.queryByRole("button", { name: "Move Cornhole Collection up" }),
    ).not.toBeInTheDocument();
  });

  it("stops the header toggling while it is being rearranged", async () => {
    const { props } = renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Cornhole Collection" }));
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("moves one step in the direction that was pressed", async () => {
    const { props } = renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Move Cornhole Collection up" }));
    expect(props.onMove).toHaveBeenCalledWith(-1);
    await userEvent.click(screen.getByRole("button", { name: "Move Cornhole Collection down" }));
    expect(props.onMove).toHaveBeenCalledWith(1);
  });

  it("does not roll the shelf up on its way past", async () => {
    // The reason the move buttons are siblings of the trigger and not inside it:
    // nested, every tap to reorder would also close what you are looking at.
    const { props } = renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Move Cornhole Collection up" }));
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("does nothing at the end of the list it is already at", async () => {
    const { props } = renderSection({ canMoveUp: false });
    const up = screen.getByRole("button", { name: "Move Cornhole Collection up" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(up);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("keeps a dead move button reachable", async () => {
    // aria-disabled rather than disabled. A real disabled lands on the button
    // that was just pressed — the one that took the shelf to the top — and a
    // disabled button hands focus back to <body>, so a keyboard user loses their
    // place halfway through rearranging.
    renderSection({ canMoveUp: false });
    const up = screen.getByRole("button", { name: "Move Cornhole Collection up" });
    expect(up).not.toBeDisabled();
    up.focus();
    expect(up).toHaveFocus();
  });

  it("wears the accent it is handed, and nothing when it is handed none", () => {
    // The secret shelves carry SECRET_RARITY.accent, which is what says "not a
    // roster card" now that they sit as peers of the roster.
    const { unmount } = renderSection({ accent: "oklch(0.9 0.19 160)" });
    expect(screen.getByRole("heading", { name: "Cornhole Collection" })).toHaveStyle({
      color: "oklch(0.9 0.19 160)",
    });
    unmount();

    renderSection({ title: "Roster" });
    expect(screen.getByRole("heading", { name: "Roster" }).style.color).toBe("");
  });
});
