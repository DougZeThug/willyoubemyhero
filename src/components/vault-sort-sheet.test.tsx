// The sheet that replaced six controls above the first card.
//
// Everything here is a choice about how to READ the binder, so the assertions are
// about state being said out loud — `aria-pressed`, not colour, which is what the
// four sort chips got wrong before they moved in here.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultSortChip, VaultSortSheet } from "./vault-sort-sheet";

beforeEach(() => {
  // The sheet is a vaul Drawer, which claims the pointer on press. jsdom has no
  // pointer capture at all — the same stubs market-panel.test.tsx installs.
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

function renderSheet(over: Partial<React.ComponentProps<typeof VaultSortSheet>> = {}) {
  const props: React.ComponentProps<typeof VaultSortSheet> = {
    open: true,
    onOpenChange: vi.fn(),
    sort: "name",
    onSort: vi.fn(),
    filter: "all",
    onFilter: vi.fn(),
    density: 2,
    onDensity: vi.fn(),
    rearranging: false,
    onRearranging: vi.fn(),
    ...over,
  };
  return { props, ...render(<VaultSortSheet {...props} />) };
}

describe("sorting", () => {
  it("offers every order the roster has, including the one that re-deals", () => {
    renderSheet();
    for (const label of ["Name", "Order", "Pick", "Rarity", "Newest", "Shuffle"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("says which one is chosen rather than only colouring it", () => {
    // A colour swap alone left a screen reader hearing six identical controls
    // and no answer to "sorted by what".
    renderSheet({ sort: "rarity" });
    expect(screen.getByRole("button", { name: "Rarity" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Name" })).toHaveAttribute("aria-pressed", "false");
  });

  it("hands the choice back", async () => {
    const { props } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(props.onSort).toHaveBeenCalledWith("newest");
  });

  it("lets shuffle be pressed again, because a re-deal is not a no-op", async () => {
    const { props } = renderSheet({ sort: "shuffle" });
    await userEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(props.onSort).toHaveBeenCalledWith("shuffle");
  });
});

describe("filtering", () => {
  it("offers all four, single-choice — owned and missing are opposites", async () => {
    const { props } = renderSheet({ filter: "spares" });
    expect(screen.getByRole("button", { name: "Spares" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Missing" }));
    expect(props.onFilter).toHaveBeenCalledWith("missing");
  });
});

describe("density", () => {
  it("switches how many cards a phone row holds", async () => {
    const { props } = renderSheet({ density: 2 });
    expect(screen.getByRole("button", { name: "2 across" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "3 across" }));
    expect(props.onDensity).toHaveBeenCalledWith(3);
  });
});

describe("rearranging", () => {
  it("closes the sheet on the way in, because the arrows are behind it", async () => {
    const { props } = renderSheet({ rearranging: false });
    await userEvent.click(screen.getByRole("button", { name: /rearrange shelves/i }));
    expect(props.onRearranging).toHaveBeenCalledWith(true);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("is also where it gets turned off, so the control is never stranded", async () => {
    const { props } = renderSheet({ rearranging: true });
    await userEvent.click(screen.getByRole("button", { name: /done rearranging/i }));
    expect(props.onRearranging).toHaveBeenCalledWith(false);
  });
});

describe("the chip the sheet is behind", () => {
  it("sits quiet on the defaults", () => {
    render(<VaultSortChip onOpen={vi.fn()} active={false} />);
    expect(screen.getByRole("button", { name: "Sort and filter the roster" })).toBeInTheDocument();
  });

  it("opens the sheet", async () => {
    const onOpen = vi.fn();
    render(<VaultSortChip onOpen={onOpen} active={false} />);
    await userEvent.click(screen.getByRole("button", { name: /sort and filter/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("lights up while anything is off the default", () => {
    // So a filtered shelf never reads as a shelf that has lost cards.
    const { container } = render(<VaultSortChip onOpen={vi.fn()} active />);
    expect(container.querySelector("button")?.className).toMatch(/text-primary/);
  });
});
