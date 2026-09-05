import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardViewer, type ViewerCard } from "./card-viewer";
import { rarityStyle } from "@/lib/card-rarity";
import { secretFoil } from "@/lib/secret-cards";

// The viewer must never reach for the router: a secret opened from the vault has
// no URL, and that is the one thing about a secret card that must not change.
// Only `Link` is used (the locked card's "Rip a pack"), so the spy on everything
// else is the assertion, not scaffolding.
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  // `to` is not an anchor attribute, so it is turned into the href the link
  // role actually needs.
  Link: ({ children, to, ...rest }: React.ComponentProps<"a"> & { to?: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back: vi.fn() } }),
  useCanGoBack: () => true,
}));

// jsdom has no Web Audio, and the flip sound rides on every tap.
vi.mock("@/lib/card-sfx", () => ({ playFlip: vi.fn() }));
import { playFlip } from "@/lib/card-sfx";

function roster(over: Partial<Extract<ViewerCard, { kind: "roster" }>> = {}) {
  return {
    kind: "roster",
    id: "ep-alice",
    name: "Alice Ace",
    rarity: rarityStyle("champion"),
    edition: "standard",
    frontUrl: null,
    backUrl: null,
    back: <div>back of Alice</div>,
    locked: false,
    copies: 1,
    ...over,
  } satisfies ViewerCard;
}

function secret(over: Partial<Extract<ViewerCard, { kind: "secret" }>> = {}) {
  return {
    kind: "secret",
    id: "secret-gary",
    name: "Gary The Grill",
    rarity: secretFoil("rosette", "none", "mythic"),
    tier: "mythic",
    flavour: "Lit at 11am. Still going at 11pm.",
    firstPulledOn: "2026-07-28",
    ownerCount: 3,
    frontUrl: null,
    backUrl: null,
    back: <div>back of Gary</div>,
    copies: 1,
    ...over,
  } satisfies ViewerCard;
}

const THREE: ViewerCard[] = [
  roster({ id: "ep-alice", name: "Alice Ace" }),
  roster({ id: "ep-bob", name: "Bob Blitz" }),
  roster({ id: "ep-cara", name: "Cara Crush" }),
];

function renderViewer(over: Partial<React.ComponentProps<typeof CardViewer>> = {}) {
  const props = {
    cards: THREE,
    index: 0,
    onStep: vi.fn(),
    onClose: vi.fn(),
    ...over,
  } satisfies React.ComponentProps<typeof CardViewer>;
  return { props, ...render(<CardViewer {...props} />) };
}

/**
 * A throw across the card, in the units `useCardZoom` reads: over `SWIPE.dist`
 * (48px), beating the other axis by `SWIPE.bias`, and inside `SWIPE.ms`.
 */
function throwCard(dx: number, dy: number) {
  const frame = screen.getByTestId("card-viewer-card").parentElement!.parentElement!;
  fireEvent.pointerDown(frame, { pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerMove(frame, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
  fireEvent.pointerUp(frame, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The dropdown is Radix, which claims the pointer on press; jsdom has none of
  // the pointer-capture API at all. Same stubs vault-sort-sheet.test.tsx installs.
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

describe("CardViewer, opening and closing", () => {
  it("announces itself as a modal dialog named after the card", () => {
    renderViewer();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Alice Ace");
  });

  it("takes focus on arrival and keeps Tab inside", () => {
    renderViewer();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    // The trap listens on document in the capture phase, so the event goes there.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("hands focus back to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = renderViewer();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("closes on Escape, on the ✕, and on a pull down", async () => {
    const { props, unmount } = renderViewer();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);

    throwCard(0, 90);
    expect(props.onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("locks the page behind it and gives the scroll back on the way out", () => {
    const { unmount } = renderViewer();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("goes to the details page on a flick up, and only when there is one", () => {
    const onDetails = vi.fn();
    const { unmount } = renderViewer({ onDetails });
    throwCard(0, -90);
    expect(onDetails).toHaveBeenCalledTimes(1);
    unmount();

    // A secret has no second step, so the same gesture does nothing at all.
    renderViewer({ cards: [secret()], index: 0 });
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
  });
});

describe("CardViewer, stepping through the list", () => {
  it("wraps forwards off the end", () => {
    const { props } = renderViewer({ index: 2 });
    throwCard(-90, 0);
    expect(props.onStep).toHaveBeenCalledWith(0);
  });

  it("wraps backwards off the start", () => {
    const { props } = renderViewer({ index: 0 });
    throwCard(90, 0);
    expect(props.onStep).toHaveBeenCalledWith(2);
  });

  it("steps with the arrow keys too", () => {
    const { props } = renderViewer({ index: 1 });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(props.onStep).toHaveBeenCalledWith(2);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(props.onStep).toHaveBeenCalledWith(0);
  });

  it("says where you are in the list, and nothing when there is only one card", () => {
    const { unmount } = renderViewer({ index: 1 });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    unmount();

    renderViewer({ cards: [roster()], index: 0 });
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it("does not step a list of one", () => {
    const { props } = renderViewer({ cards: [roster()], index: 0 });
    throwCard(-90, 0);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(props.onStep).not.toHaveBeenCalled();
  });
});

describe("CardViewer, turning the card over", () => {
  it("flips on the Flip control and says which face is showing", async () => {
    renderViewer();
    const flip = screen.getByRole("button", { name: "Flip" });
    expect(flip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(flip);
    expect(screen.getByRole("button", { name: "Front" })).toHaveAttribute("aria-pressed", "true");
    expect(playFlip).toHaveBeenCalled();
  });

  it("lands the next card face up, however the last one was left", async () => {
    const { rerender } = renderViewer({ index: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Flip" }));
    expect(screen.getByRole("button", { name: "Front" })).toBeInTheDocument();

    rerender(<CardViewer cards={THREE} index={1} onStep={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Flip" })).toBeInTheDocument();
  });

  it("does not flip on the tap a throw interrupted", async () => {
    const onDetails = vi.fn();
    const { props } = renderViewer({ onDetails });
    // A tap holds its flip back for TAP.gap, so a double tap can zoom instead.
    // A throw landing inside that window has to cancel it, or the card turns
    // 300ms after somebody has already swiped or dismissed it.
    throwCard(0, 0);
    throwCard(0, -90);
    expect(onDetails).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("button", { name: "Flip" })).toBeInTheDocument();
    expect(props.onStep).not.toHaveBeenCalled();
  });

  it("cannot flip a card nobody has packed", () => {
    renderViewer({ cards: [roster({ locked: true, copies: 0 })], index: 0 });
    expect(screen.getByRole("button", { name: "Flip" })).toBeDisabled();
  });
});

describe("CardViewer, a secret", () => {
  it("never navigates — a secret card has no address", () => {
    const { props } = renderViewer({ cards: [secret(), secret({ id: "s2", name: "The Gazebo" })] });
    throwCard(-90, 0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onStep).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("says the level, the day and the people, and never a set size", () => {
    renderViewer({ cards: [secret({ copies: 2 })], index: 0 });
    expect(screen.getByText(/mythic/i)).toBeInTheDocument();
    expect(screen.getByText(/Pulled ×2/)).toBeInTheDocument();
    expect(screen.getByText(/Packed by 3/)).toBeInTheDocument();
    // The load-bearing negative: no denominator anywhere, ever.
    expect(document.body.textContent).not.toMatch(/of \d+ secrets/i);
    expect(document.body.textContent).not.toMatch(/\d+ \/ \d+ secrets/i);
  });

  it("tells the only finder they are the only finder", () => {
    renderViewer({ cards: [secret({ ownerCount: 1 })], index: 0 });
    expect(screen.getByText(/only one who has found this/i)).toBeInTheDocument();
  });
});

describe("CardViewer, a locked card", () => {
  it("shows the way to unlock it rather than the tier it would be", () => {
    renderViewer({
      cards: [roster({ locked: true, copies: 0, rarity: rarityStyle("dnf") })],
      index: 0,
    });
    expect(screen.getByRole("link", { name: /rip a pack to see this card/i })).toBeInTheDocument();
    // The tier is the one thing a face-down slot must not give away.
    expect(document.body.textContent).not.toMatch(/DNF/i);
  });
});

describe("CardViewer, the More menu", () => {
  async function openMenu() {
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    return within(await screen.findByRole("menu"));
  }

  it("offers Share and Compare on a roster card you hold", async () => {
    renderViewer({ onShare: vi.fn(), onCompare: vi.fn() });
    const menu = await openMenu();
    expect(menu.getByRole("menuitem", { name: /share/i })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: /compare/i })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: /^pin$/i })).toBeInTheDocument();
  });

  it("offers neither on a secret — no export, and nothing to line it up against", async () => {
    renderViewer({ cards: [secret()], index: 0, onShare: undefined, onCompare: undefined });
    const menu = await openMenu();
    expect(menu.queryByRole("menuitem", { name: /share/i })).not.toBeInTheDocument();
    expect(menu.queryByRole("menuitem", { name: /compare/i })).not.toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: /^pin$/i })).toBeInTheDocument();
  });

  it("offers a card only when there is a spare of it", async () => {
    const { unmount } = renderViewer({ onOffer: vi.fn() });
    expect((await openMenu()).queryByRole("menuitem", { name: /offer this card/i })).toBe(null);
    unmount();

    renderViewer({ cards: [roster({ copies: 2 })], index: 0, onOffer: vi.fn() });
    expect(
      (await openMenu()).getByRole("menuitem", { name: /offer this card/i }),
    ).toBeInTheDocument();
  });

  it("asks for a card only when it is one you have not packed", async () => {
    const { unmount } = renderViewer({ onAsk: vi.fn() });
    expect((await openMenu()).queryByRole("menuitem", { name: /ask for this card/i })).toBe(null);
    unmount();

    renderViewer({ cards: [roster({ locked: true, copies: 0 })], index: 0, onAsk: vi.fn() });
    expect(
      (await openMenu()).getByRole("menuitem", { name: /ask for this card/i }),
    ).toBeInTheDocument();
  });

  it("neither pins nor shares a card nobody has packed", () => {
    renderViewer({
      cards: [roster({ locked: true, copies: 0 })],
      index: 0,
      onShare: vi.fn(),
      onCompare: vi.fn(),
    });
    // Every entry is gated on the card being one you hold, so there is nothing
    // behind the trigger and the trigger says so rather than opening on nothing.
    expect(screen.getByRole("button", { name: "More actions" })).toBeDisabled();
  });

  it("will not start a second export over the first", async () => {
    renderViewer({ onShare: vi.fn(), sharing: true });
    const menu = await openMenu();
    expect(menu.getByRole("menuitem", { name: /rendering/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("leaves Escape to the menu while the menu is open", async () => {
    const { props } = renderViewer();
    await openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    // Escape over an open menu shuts the menu, not the card.
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("pins the card, and says so", async () => {
    renderViewer();
    await userEvent.click((await openMenu()).getByRole("menuitem", { name: /^pin$/i }));
    expect((await openMenu()).getByRole("menuitem", { name: /pinned/i })).toBeInTheDocument();
  });
});
