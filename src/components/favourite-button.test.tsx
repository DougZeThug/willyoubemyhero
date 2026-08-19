import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FavouriteButton } from "./favourite-button";

describe("FavouriteButton", () => {
  it("says which card it pins, and which way the tap goes", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FavouriteButton name="Alice Ace" on={false} onToggle={onToggle} />,
    );
    const off = screen.getByRole("button", { name: "Pin Alice Ace to the top" });
    expect(off).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(off);
    expect(onToggle).toHaveBeenCalledTimes(1);

    // The same control reporting a new state, not a different control: a screen
    // reader announces the change on the button the user just operated.
    rerender(<FavouriteButton name="Alice Ace" on onToggle={onToggle} />);
    const on = screen.getByRole("button", { name: "Unpin Alice Ace from the top" });
    expect(on).toHaveAttribute("aria-pressed", "true");
  });

  it("neither navigates nor reaches the card underneath it", () => {
    // The whole reason this component owns its own event handling. On the roster
    // tile it sits over a <Link> that wraps the entire card, and TanStack
    // Router's Link navigates from a React onClick — so a star that let the
    // click through would open the player page every time somebody pinned.
    const onToggle = vi.fn();
    const tile = vi.fn();
    render(
      <a href="/players/alice" onClick={tile}>
        <FavouriteButton name="Alice Ace" on={false} onToggle={onToggle} />
      </a>,
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("button").dispatchEvent(click);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
    expect(tile).not.toHaveBeenCalled();
  });
});
