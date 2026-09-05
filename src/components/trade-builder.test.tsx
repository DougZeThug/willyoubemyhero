// Building an offer, as three screens.
//
// Rendered with NO PROVIDERS AT ALL — no router, no QueryClient, no server
// function — and that is the assertion rather than a shortcut. The builder holds
// the offer and nothing else: `onSend` and `onClose` are props, and the only data
// it reaches for is the two spares lists it draws. Anything that made this file
// need a wrapper would mean the flow had grown a dependency it should not have.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeBuilder } from "./trade-builder";
import { rarityStyle } from "@/lib/card-rarity";
import type { RosterSpare, SecretSpare, TradeSpares } from "@/lib/trades";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// HoloCard is a 3D tilt rig over an image pipeline; the tiles only need to be
// findable by name. Same stub market-panel.test.tsx installs.
vi.mock("./holo-card", () => ({
  HoloCard: ({ name }: { name: string }) => <div>{name}</div>,
  FLIP_CURVE: "linear",
  FLIP_EDGE_AT: 0.384,
}));

const SPARES = vi.hoisted(() => ({ current: {} as Record<string, TradeSpares | undefined> }));
vi.mock("@/hooks/use-trades", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-trades")>()),
  useTradeSpares: (participantId: string | null) => ({
    data: participantId ? SPARES.current[participantId] : undefined,
    isPending: false,
  }),
}));

const ME = "p-me";
const THEM = "p-them";
const OTHER = "p-other";

const roster = (over: Partial<RosterSpare> = {}): RosterSpare => ({
  copyId: "copy-1",
  eventParticipantId: "ep-alice",
  edition: "standard",
  viewerOwns: true,
  assertedBy: "server",
  ...over,
});

const secret = (over: Partial<SecretSpare> = {}): SecretSpare => ({
  pullId: "pull-1",
  name: "Gary The Grill",
  artUrl: null,
  tier: "epic",
  lastCopy: false,
  viewerOwns: true,
  ...over,
});

const NAMES: Record<string, string> = {
  [THEM]: "Bob Blitz",
  [OTHER]: "Carol Crush",
  "ep-alice": "Alice Ace",
  "ep-bob": "Bob Blitz",
  "ep-carol": "Carol Crush",
  "ep-dave": "Dave Dnf",
  "ep-erin": "Erin Edge",
};

function renderBuilder(over: Partial<React.ComponentProps<typeof TradeBuilder>> = {}) {
  const props: React.ComponentProps<typeof TradeBuilder> = {
    me: ME,
    counterparties: [
      { id: THEM, name: "Bob Blitz" },
      { id: OTHER, name: "Carol Crush" },
    ],
    nameOf: (id) => NAMES[id] ?? "Someone",
    lookup: (id) => ({ name: NAMES[id] ?? "—", frontUrl: null, rarity: rarityStyle("base") }),
    backUrl: null,
    outOfSeason: false,
    offline: false,
    sending: false,
    intent: null,
    onSend: vi.fn(async () => "offer-1"),
    onClose: vi.fn(),
    ...over,
  };
  return { props, ...render(<TradeBuilder {...props} />) };
}

/** Who → trays, which every test past the first step has to walk. */
async function pickPartner(name = "Bob Blitz") {
  await userEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

beforeEach(() => {
  // The picker is a vaul Drawer, which claims the pointer on press. jsdom has no
  // pointer capture at all — the same stubs vault-sort-sheet.test.tsx installs.
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();

  SPARES.current = {
    [ME]: {
      participantId: ME,
      // Two copies of one card in different finishes: the thing per-copy trading
      // exists for, and why the picker shows two tiles rather than a count.
      roster: [
        roster({ copyId: "mine-plat", edition: "platinum" }),
        roster({ copyId: "mine-std", edition: "standard" }),
      ],
      secrets: [secret({ pullId: "mine-secret", lastCopy: true })],
      blocked: [
        {
          item: {
            kind: "roster",
            copyId: "blocked-1",
            eventParticipantId: "ep-dave",
            edition: "standard",
          },
          reason: "only-copy",
        },
      ],
      ownedRoster: [],
    },
    [THEM]: {
      participantId: THEM,
      // Five, so the four-a-side cap is actually reachable.
      roster: ["a", "b", "c", "d", "e"].map((k, i) =>
        roster({
          copyId: `theirs-${k}`,
          eventParticipantId: ["ep-bob", "ep-carol", "ep-dave", "ep-erin", "ep-alice"][i],
        }),
      ),
      secrets: [],
      blocked: [],
      ownedRoster: [],
    },
    [OTHER]: { participantId: OTHER, roster: [], secrets: [], blocked: [], ownedRoster: [] },
  };
});

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.clearAllMocks();
});

describe("who", () => {
  it("lists everyone reachable as a row that says how much they have", () => {
    // A wrapping row of identical pills told you nothing about who had what.
    renderBuilder();
    expect(screen.getByRole("button", { name: "Bob Blitz, 5 spares" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carol Crush, 0 spares" })).toBeInTheDocument();
  });

  it("says which row is chosen out loud, not only in colour", async () => {
    renderBuilder();
    const bob = screen.getByRole("button", { name: /Bob Blitz/ });
    expect(bob).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(bob);
    expect(bob).toHaveAttribute("aria-pressed", "true");
  });

  it("will not move on until somebody is picked, and says why", () => {
    renderBuilder();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Pick who to trade with.")).toBeInTheDocument();
  });

  it("says so when there is nobody to trade with", () => {
    renderBuilder({ counterparties: [] });
    expect(screen.getByText(/nobody else has claimed/i)).toBeInTheDocument();
  });

  it("closes rather than stepping back, from the first step", async () => {
    const { props } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

describe("give and get", () => {
  it("walks who → trays → review, and back again", async () => {
    renderBuilder();
    expect(screen.getByRole("heading", { name: /who are you trading with/i })).toBeInTheDocument();

    await pickPartner();
    expect(screen.getByRole("heading", { name: /what is on the table/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "You give" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "You get" })).toBeInTheDocument();

    await stage("give", /Alice Ace/);
    await stage("want", /Bob Blitz/);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("heading", { name: /does this look right/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("heading", { name: /what is on the table/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("heading", { name: /who are you trading with/i })).toBeInTheDocument();
  });

  it("stages a card out of the picker and shows it in the tray", async () => {
    renderBuilder();
    await pickPartner();
    expect(tray("You give")).toHaveTextContent("0 / 4");
    await stage("give", /Alice Ace/);
    expect(tray("You give")).toHaveTextContent("1 / 4");
    expect(within(tray("You give")).getByRole("button", { name: /remove alice ace/i })).toBeInTheDocument(); // prettier-ignore
  });

  it("takes a staged card back off again", async () => {
    renderBuilder();
    await pickPartner();
    await stage("give", /Alice Ace/);
    await userEvent.click(
      within(tray("You give")).getByRole("button", { name: /remove alice ace/i }),
    );
    expect(tray("You give")).toHaveTextContent("0 / 4");
  });

  it("refuses a fifth card a side and says that is the limit", async () => {
    renderBuilder();
    await pickPartner();
    await userEvent.click(within(tray("You get")).getByRole("button", { name: /ask for/i }));
    const picker = screen.getByRole("dialog");
    for (const who of ["Bob Blitz", "Carol Crush", "Dave Dnf", "Erin Edge", "Alice Ace"]) {
      await userEvent.click(within(picker).getByRole("button", { name: new RegExp(who) }));
    }
    expect(toast).toHaveBeenCalledWith("4 cards a side is the limit");
    // And the fifth is not pressed, so the cap is a refusal rather than a toast
    // over a staged card.
    expect(within(picker).getByRole("button", { name: /Alice Ace/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(picker).toHaveTextContent("4 / 4 chosen");
  });

  it("will not reach review until both sides have a card", async () => {
    renderBuilder();
    await pickPartner();
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
    expect(screen.getByText("Add at least one of your cards.")).toBeInTheDocument();

    await stage("give", /Alice Ace/);
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
    expect(screen.getByText("Ask for at least one of theirs.")).toBeInTheDocument();

    await stage("want", /Bob Blitz/);
    expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
  });

  it("clears both trays when the partner changes, because their cards were half the offer", async () => {
    renderBuilder();
    await pickPartner();
    await stage("give", /Alice Ace/);
    expect(tray("You give")).toHaveTextContent("1 / 4");

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    await userEvent.click(screen.getByRole("button", { name: /Carol Crush/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(tray("You give")).toHaveTextContent("0 / 4");
  });

  it("says an empty side is the season rather than a broken screen", async () => {
    // B-33: "No spares to trade." on a full collection reads as a bug. And the
    // reason lives on the TRAY, not behind a drawer nobody has opened.
    renderBuilder({ outOfSeason: true, counterparties: [{ id: OTHER, name: "Carol Crush" }] });
    SPARES.current[ME] = {
      participantId: ME,
      roster: [],
      secrets: [],
      blocked: [],
      ownedRoster: [],
    };
    await pickPartner("Carol Crush");
    expect(screen.getAllByText("Trading opens with the next combine.")).toHaveLength(2);
    expect(screen.queryByText("No spares to trade.")).not.toBeInTheDocument();
  });
});

describe("what cannot be traded", () => {
  it("greys a blocked card with its reason and offers nothing to press", async () => {
    // A card that simply vanishes from the picker reads as data loss, which is
    // what people actually report.
    renderBuilder();
    await pickPartner();
    await userEvent.click(
      within(tray("You give")).getByRole("button", { name: /add your cards/i }),
    );
    const picker = screen.getByRole("dialog");

    expect(within(picker).getByText("Can't be traded")).toBeInTheDocument();
    expect(within(picker).getByText("only copy")).toBeInTheDocument();
    // Dave is the blocked card and appears nowhere as a control.
    expect(within(picker).queryByRole("button", { name: /Dave Dnf/ })).not.toBeInTheDocument();

    await userEvent.click(within(picker).getAllByText("Dave Dnf")[0]);
    expect(picker).toHaveTextContent("0 / 4 chosen");
  });

  it("still opens the picker for somebody whose every card is blocked", async () => {
    // The greyed row IS the answer to "where is my card?". A tray that counted
    // only stakeable cards would hide the button that leads to it.
    SPARES.current[ME] = {
      participantId: ME,
      roster: [],
      secrets: [],
      blocked: [
        {
          item: {
            kind: "roster",
            copyId: "blocked-1",
            eventParticipantId: "ep-dave",
            edition: "standard",
          },
          reason: "only-copy",
        },
      ],
      ownedRoster: [],
    };
    renderBuilder();
    await pickPartner();
    expect(screen.queryByText("No spares to trade.")).not.toBeInTheDocument();
    await userEvent.click(
      within(tray("You give")).getByRole("button", { name: /add your cards/i }),
    );
    expect(within(openPicker()).getByText("only copy")).toBeInTheDocument();
  });

  it("says a last copy in words, in the picker and again on review", async () => {
    renderBuilder();
    await pickPartner();
    await stage("give", /Gary The Grill/);
    await stage("want", /Bob Blitz/);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/last copy\. it does not come back/i)).toBeInTheDocument();
  });
});

describe("review", () => {
  it("reads the deal back as one line", async () => {
    renderBuilder();
    await pickPartner();
    await stage("give", /Gary The Grill/);
    await stage("want", /Bob Blitz/);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    // The whole line, not three separate texts: what this step exists for is
    // that the deal reads as one sentence rather than as two piles of cards.
    const summary = screen.getByText(/with Bob Blitz\./).closest("p");
    expect(summary).toHaveTextContent("Gary The Grill for 1 card, with Bob Blitz.");
  });

  it("hands both sides over as the payloads the RPC takes", async () => {
    const { props } = renderBuilder();
    await pickPartner();
    await stage("give", /Gary The Grill/);
    await stage("want", /Bob Blitz/);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(screen.getByRole("button", { name: /send offer/i }));

    expect(props.onSend).toHaveBeenCalledOnce();
    const sent = vi.mocked(props.onSend).mock.calls[0][0];
    expect(sent.recipientId).toBe(THEM);
    expect(sent.give.map((s) => s.payload)).toEqual([
      { kind: "secret", secretPullId: "mine-secret" },
    ]);
    expect(sent.want.map((s) => s.payload)).toEqual([{ kind: "roster", cardCopyId: "theirs-a" }]);
  });

  it("stays open when the send fails, so nothing built is lost", async () => {
    const { props } = renderBuilder({ onSend: vi.fn(async () => null) });
    await pickPartner();
    await stage("give", /Alice Ace/);
    await stage("want", /Bob Blitz/);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(screen.getByRole("button", { name: /send offer/i }));

    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /does this look right/i })).toBeInTheDocument();
  });

  it("goes quiet offline, with the reason on the screen", async () => {
    renderBuilder({ offline: true });
    await pickPartner();
    await stage("give", /Alice Ace/);
    await stage("want", /Bob Blitz/);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("button", { name: /send offer/i })).toBeDisabled();
    expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
  });
});

describe("arriving from a card", () => {
  it("stages the plainest copy of the card somebody tapped, once a partner is picked", async () => {
    renderBuilder({ intent: { side: "give", kind: "roster", eventParticipantId: "ep-alice" } });
    expect(screen.getByText(/offering your spare Alice Ace/i)).toBeInTheDocument();

    await pickPartner();
    // The standard copy, not the platinum: you asked for the card, not the metal.
    expect(
      within(tray("You give")).getByRole("button", { name: /remove alice ace/i }),
    ).toBeInTheDocument();
    expect(tray("You give")).toHaveTextContent("1 / 4");
  });

  it("says so when the person picked has no spare of it", async () => {
    renderBuilder({ intent: { side: "want", kind: "roster", eventParticipantId: "ep-nobody" } });
    await userEvent.click(screen.getByRole("button", { name: /Bob Blitz/ }));
    expect(screen.getByText(/Bob Blitz has no spare/i)).toBeInTheDocument();
  });
});

describe("getting out", () => {
  it("closes on Escape", async () => {
    const { props } = renderBuilder();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("leaves the builder alone when Escape lands on the picker", async () => {
    // Escape over an open drawer means "shut the drawer", not "throw the offer
    // away". Same deference card-viewer.tsx gives its own menu.
    const { props } = renderBuilder();
    await pickPartner();
    await userEvent.click(
      within(tray("You give")).getByRole("button", { name: /add your cards/i }),
    );
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

/** The tray section, by the accessible name the offer card shares with it. */
function tray(label: string): HTMLElement {
  return screen.getByRole("region", { name: label });
}

/** Open a tray's picker, tap one card, close it again. */
async function stage(side: "give" | "want", card: RegExp) {
  const label = side === "give" ? "You give" : "You get";
  await userEvent.click(within(tray(label)).getByRole("button", { name: opener(side) }));
  const picker = openPicker();
  // The first match, not the only one: two copies of one card are two tiles
  // named the same thing, which is the whole point of per-copy trading.
  await userEvent.click(within(picker).getAllByRole("button", { name: card })[0]);
  await userEvent.click(within(picker).getByRole("button", { name: /^done$/i }));
  await sheetGone();
}

const opener = (side: "give" | "want") => (side === "give" ? /add your cards/i : /ask for/i);

/**
 * The sheet on screen now.
 *
 * `at(-1)`, because vaul leaves a closed sheet's node behind until an animation
 * event jsdom never fires — the component takes it out on a timer, and until
 * that fires there are two.
 */
function openPicker(): HTMLElement {
  return screen.getAllByRole("dialog").at(-1)!;
}

/**
 * Wait for the closed sheet to release the page.
 *
 * vaul locks the body while a sheet is up. Nothing else on the builder can be
 * touched until that lifts, which is the whole reason the sheet unmounts on a
 * timer rather than on a transition.
 */
async function sheetGone() {
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
}
