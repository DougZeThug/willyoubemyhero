// The one exception to the vault's silence, pinned where it actually renders.
//
// The mystery slot is the only thing this app is allowed to say about secrets
// nobody has pulled, and it is only allowed in one exact shape: one tile at the
// end of an open set, never a second, never a number, and never on a set that has
// already been finished. Two of those three rules are invisible in the component
// itself — they live in the condition at the render site — so this is where they
// have to be held.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import PlayersPage from "./players.index";
import { rosterFavouriteId, setVaultFavourites } from "@/lib/vault-favourites";
import { setVaultLayout, type VaultFilter } from "@/lib/vault-layout";
import { EVENT_ID, makeBundle, makeParticipant, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();
const useCollectionTrophies = vi.fn();
const useMySecrets = vi.fn();
const useMemberSession = vi.fn();
const useMyCollection = vi.fn();
const useMilestoneClaim = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

// Every query on this page is stubbed through its own hook below, so the one
// call left reaching for react-query directly — the set list — resolves to
// nothing and falls back to the shipped labels. "Pets" is one of those.
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(() => ({ data: undefined })) }));

vi.mock("@/hooks/use-event-bundle", () => ({ useEventBundle: () => useEventBundle() }));

/** What the hook hands back once the bundle has settled. */
const settledBundle = (over: Record<string, unknown> = {}) => ({
  event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
  bundle: makeBundle(),
  error: null,
  loading: false,
  failedTables: [] as string[],
  realtimeDegraded: false,
  refetch: vi.fn(() => Promise.resolve()),
  ...over,
});

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventCardUrls: () => ({ data: undefined }),
  useEventCardBack: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-daily-secret", () => ({
  useSecretActor: () => "m:me",
  useSecretStatus: () => ({ data: undefined }),
  useMySecrets: (...args: unknown[]) => useMySecrets(...args),
}));

vi.mock("@/hooks/use-collection-trophies", () => ({
  useCollectionTrophies: () => useCollectionTrophies(),
}));

vi.mock("@/hooks/use-card-pulls", () => ({ useCardPullCounts: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-trade-badge", () => ({ useTradeBadge: () => 0 }));
vi.mock("@/hooks/use-streak", () => ({
  useStreakStatus: () => ({ data: null, isPending: false }),
}));
vi.mock("@/hooks/use-dust", () => ({ useDustBalance: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-online", () => ({ useIsOnline: () => true }));
vi.mock("@/hooks/use-recent-acquisitions", () => ({
  useRecentAcquisitions: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-milestone-claim", () => ({
  useMilestoneClaim: (...args: unknown[]) => useMilestoneClaim(...args),
}));
vi.mock("@/hooks/use-my-collection", () => ({
  useMyCollection: (...args: unknown[]) => useMyCollection(...args),
}));

// Partial, because both of these modules export helpers the page calls as well as
// the hook it reads.
vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMemberSession: () => useMemberSession() };
});

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    stubs[name] =
      typeof value === "function"
        ? (props: Record<string, unknown>) => <svg data-lucide-stub={name} {...props} />
        : value;
  }
  return stubs;
});

const ME = "p-me";

/** Two cards from one shipped set, so the shelf is "Pets" rather than the pile. */
const PETS = [
  {
    id: "sec-gary",
    name: "Gary The Grill",
    flavour: null,
    foil: "rosette",
    borderFx: "spin",
    collection: "pets",
    artUrl: null,
    backUrl: null,
    tier: "rare",
    firstPulledOn: "2026-07-28",
    count: 1,
    ownerCount: 2,
  },
  {
    id: "sec-gazebo",
    name: "The Gazebo",
    flavour: null,
    foil: "rosette",
    borderFx: "spin",
    collection: "pets",
    artUrl: null,
    backUrl: null,
    tier: "common",
    firstPulledOn: "2026-07-27",
    count: 1,
    ownerCount: 1,
  },
];

/** The Pets shelf, found by its heading and read as a whole. */
function petsShelf() {
  const heading = screen.getByRole("heading", { level: 2, name: /pets/i });
  const shelf = heading.closest("section");
  if (!shelf) throw new Error("Pets shelf has no section around it");
  return shelf;
}

/**
 * The set chips on the shelf's CARDS, excluding the shelf's own heading.
 *
 * The heading says the same word for a different reason — it names the panel,
 * where these name the cards — and counting it too would let an assertion about
 * the cards pass on a shelf that had lost every one of them.
 */
function setChips() {
  return within(petsShelf())
    .getAllByText("Pets")
    .filter((el) => el.tagName !== "H2");
}

beforeEach(() => {
  resetFixtureIds();
  useEventBundle.mockReturnValue(settledBundle());
  useMySecrets.mockReturnValue({ data: { cards: PETS, pulled: PETS.length } });
  useCollectionTrophies.mockReturnValue({ data: { trophies: [] } });
  useMemberSession.mockReturnValue({ participantId: ME });
  useMyCollection.mockReturnValue({
    collection: {},
    collectedCount: 0,
    ready: true,
    markCollected: vi.fn(),
  });
  useMilestoneClaim.mockReturnValue({ milestoneReveal: null, claim: vi.fn(), claiming: false });
});

describe("the vault's summary line", () => {
  // `ready` is the collection's flag and the roster is a second request, so the
  // line used to print "Roster 0 / 0" over a bundle that simply had not answered.
  const roster = () => [makeParticipant(), makeParticipant()];

  it("states the roster once the bundle has landed", () => {
    useEventBundle.mockReturnValue(
      settledBundle({ bundle: makeBundle({ participants: roster() }) }),
    );
    render(<PlayersPage />);
    expect(screen.getByText(/Roster 0 \/ 2/)).toBeInTheDocument();
  });

  it("stays blank while the bundle is still loading", () => {
    useEventBundle.mockReturnValue(settledBundle({ bundle: undefined, loading: true }));
    render(<PlayersPage />);
    expect(screen.queryByText(/Roster \d+ \/ \d+/)).toBeNull();
  });

  it("reports a failed roster read without a zero count and allows a retry", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    useEventBundle.mockReturnValue(
      settledBundle({
        bundle: makeBundle({ participants: [], failed: ["event_participants"] }),
        failedTables: ["event_participants"],
        refetch,
      }),
    );
    render(<PlayersPage />);
    expect(screen.queryByText(/Roster \d+ \/ \d+/)).toBeNull();
    const shelf = screen.getByRole("heading", { name: "Roster" }).closest("section");
    if (!shelf) throw new Error("Roster shelf has no section");
    expect(within(shelf).getByText("Couldn't read the roster just now.")).toBeInTheDocument();
    expect(within(shelf).queryByText("No participants yet.")).not.toBeInTheDocument();
    expect(within(shelf).queryByText("0")).not.toBeInTheDocument();
    await userEvent.click(within(shelf).getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each([[[]], [["runs"]]])(
    "shows a genuinely empty roster when failed tables are %s",
    (failedTables) => {
      useEventBundle.mockReturnValue(
        settledBundle({
          bundle: makeBundle({ participants: [], failed: failedTables }),
          failedTables,
        }),
      );
      render(<PlayersPage />);
      const shelf = screen.getByRole("heading", { name: "Roster" }).closest("section");
      if (!shelf) throw new Error("Roster shelf has no section");
      expect(within(shelf).getByText("No participants yet.")).toBeInTheDocument();
      expect(within(shelf).getByText("0")).toBeInTheDocument();
    },
  );

  it("stays blank when the whole bundle failed", () => {
    useEventBundle.mockReturnValue(
      settledBundle({ bundle: undefined, error: new Error("offline") }),
    );
    render(<PlayersPage />);
    expect(screen.queryByText(/Roster \d+ \/ \d+/)).toBeNull();
  });
});

describe("the mystery slot on a set shelf", () => {
  it("ends an open set with one tile, and only one", () => {
    render(<PlayersPage />);
    const shelf = petsShelf();

    expect(within(shelf).getByRole("img", { name: "Unknown cards remain" })).toBeInTheDocument();
    // The rule this exists to keep. One tile whether one card is left or twenty,
    // so a count of them can never be a count of what is missing.
    expect(within(shelf).getAllByText("More in this set")).toHaveLength(1);
  });

  it("says nothing at the end of a set you have finished", () => {
    // The trophy has already told you the size, so there is no horizon left to
    // point at — and a slot after it would contradict the plaque.
    useCollectionTrophies.mockReturnValue({
      data: {
        trophies: [
          {
            participantId: ME,
            collection: "pets",
            label: "Pets",
            size: 2,
            completedOn: "2026-07-28",
            via: "pull",
          },
        ],
      },
    });
    render(<PlayersPage />);

    expect(screen.queryByRole("img", { name: "Unknown cards remain" })).toBeNull();
    expect(screen.queryByText("More in this set")).toBeNull();
  });

  it("keeps out of the shelf's count", () => {
    // The header says how many of this set you HOLD. The slot is not one of them,
    // and a shelf reading 3 over two cards would be a denominator by accident.
    render(<PlayersPage />);
    expect(within(petsShelf()).getByText("2")).toBeInTheDocument();
    expect(within(petsShelf()).queryByText("3")).toBeNull();
  });

  it("prints the set on the card as well as over the shelf", () => {
    // A favourite leaves its set's panel for the pinned shelf, and the viewer and
    // the trade screen have no panels at all — so the card has to carry it.
    render(<PlayersPage />);
    expect(setChips()).toHaveLength(PETS.length);
  });

  it("says nothing to a guest, who has no way of knowing a set is done", () => {
    // A completion trophy is the only thing that can tell a client a set is
    // finished — the size is never sent — and a guest has no trophies by design.
    // So a guest who HAD finished a set would be promised a card that does not
    // exist, and there is no client-side way to tell the two apart.
    useMemberSession.mockReturnValue(null);
    render(<PlayersPage />);

    // The shelf and its cards are still theirs; only the horizon is withheld. A
    // chip per card, so this cannot pass on a shelf that rendered no cards at all.
    expect(setChips()).toHaveLength(PETS.length);
    expect(screen.queryByRole("img", { name: "Unknown cards remain" })).toBeNull();
    expect(screen.queryByText("More in this set")).toBeNull();
  });

  it("leaves the unsorted pile alone", () => {
    // "Secrets" is a pile, not a set: there is no set behind it that could have
    // more in it, so pointing at a horizon there would be inventing one.
    useMySecrets.mockReturnValue({
      data: { cards: PETS.map((c) => ({ ...c, collection: null })), pulled: PETS.length },
    });
    render(<PlayersPage />);

    expect(screen.getByRole("heading", { level: 2, name: /^secrets$/i })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Unknown cards remain" })).toBeNull();
  });
});

describe("a secret open in the viewer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setVaultFavourites([]);
  });

  async function openGazebo() {
    const view = render(<PlayersPage />);
    // The second card on the shelf, so a stale index and the right one differ.
    await userEvent.click(screen.getByRole("button", { name: /^The Gazebo/ }));
    expect(screen.getByRole("dialog", { name: "The Gazebo" })).toBeInTheDocument();
    return view;
  }

  it("stays on the same card after it is pinned from the viewer's own menu", async () => {
    // Pinning lifts the card out of its shelf into Favourites, which reorders the
    // list the viewer is reading. An index kept across that landed on a neighbour.
    await openGazebo();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /^pin$/i }));

    expect(screen.getByRole("dialog", { name: "The Gazebo" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Gary The Grill" })).toBeNull();
  });

  it("closes when the card leaves the list, rather than showing a neighbour", async () => {
    const view = await openGazebo();
    useMySecrets.mockReturnValue({ data: { cards: [PETS[0]], pulled: 1 } });
    view.rerender(<PlayersPage />);

    expect(screen.queryByTestId("card-viewer")).toBeNull();
  });
});

// Why the roster shelf is empty. Each sentence has a different next move, and all
// five are the same markup, so only the words tell them apart.
//
// The last fallback in emptyRosterMessage (filter "all", unpinned cards exist, yet
// nothing matches) cannot be reached: "all" matches every row, so either nothing is
// unpinned or something matches. It gets no test on purpose.
describe("why the roster shelf is empty", () => {
  const firstCard = makeParticipant();
  const secondCard = makeParticipant();

  /** Only the fields the vault reads; `count` is what a spare is made of. */
  const held = (id: string, count = 1) => ({
    eventParticipantId: id,
    pulledAt: 1,
    count,
    tier: "base",
  });

  function showRoster(filter: VaultFilter, collection: Record<string, unknown>, pinned: string[]) {
    // Before render: the page reads the stored filter, not a prop.
    setVaultLayout({ order: [], collapsed: [], sort: "name", filter, density: 2 });
    setVaultFavourites(pinned.map(rosterFavouriteId));
    // No secrets, so no secret shelf can stand in for the roster's own message.
    useMySecrets.mockReturnValue({ data: { cards: [], pulled: 0 } });
    useEventBundle.mockReturnValue(
      settledBundle({ bundle: makeBundle({ participants: [firstCard, secondCard] }) }),
    );
    useMyCollection.mockReturnValue({
      collection,
      collectedCount: Object.keys(collection).length,
      ready: true,
      markCollected: vi.fn(),
    });
    render(<PlayersPage />);
  }

  afterEach(() => {
    // `current` in both stores outlives the test that set it.
    setVaultLayout({ order: [], collapsed: [], sort: "name", filter: "all", density: 2 });
    setVaultFavourites([]);
  });

  it("says every card is pinned when nothing is left below Favourites", () => {
    showRoster(
      "all",
      { [firstCard.id]: held(firstCard.id), [secondCard.id]: held(secondCard.id) },
      [firstCard.id, secondCard.id],
    );
    expect(screen.getByText("Every card is pinned to Favourites.")).toBeInTheDocument();
  });

  it("says every matching card is pinned when the filter's cards are all upstairs", () => {
    // firstCard is owned and pinned, secondCard is locked: the "owned" filter matches firstCard, which is
    // not on this shelf, so "Nothing packed yet" would be a lie.
    showRoster("owned", { [firstCard.id]: held(firstCard.id) }, [firstCard.id]);
    expect(screen.getByText("Every matching card is pinned to Favourites.")).toBeInTheDocument();
  });

  it("says no spares yet when nothing has a second copy", () => {
    showRoster("spares", { [firstCard.id]: held(firstCard.id) }, []);
    expect(
      screen.getByText("No spares yet. A second copy of a card turns up here."),
    ).toBeInTheDocument();
  });

  it("says nothing is missing when every card is collected", () => {
    showRoster(
      "missing",
      { [firstCard.id]: held(firstCard.id), [secondCard.id]: held(secondCard.id) },
      [],
    );
    expect(screen.getByText("Nothing missing — you have packed every card.")).toBeInTheDocument();
  });

  it("points at today's pack when nothing is collected yet", () => {
    showRoster("owned", {}, []);
    expect(screen.getByText("Nothing packed yet. Open today's pack.")).toBeInTheDocument();
  });
});

// The same banner five other screens show. It stays quiet while a reveal has the
// screen, and the condition for that lives only at the render site.
describe("the degraded-feed banner", () => {
  const BANNER = "Live feed down — refreshing every few seconds";

  it("shows when the live channel is down", () => {
    useEventBundle.mockReturnValue(settledBundle({ realtimeDegraded: true }));
    render(<PlayersPage />);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("shows when the bundle failed to load", () => {
    useEventBundle.mockReturnValue(settledBundle({ error: new Error("offline") }));
    render(<PlayersPage />);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("stays away on a healthy feed", () => {
    render(<PlayersPage />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("stays silent while a milestone reveal has the screen, even when degraded", () => {
    useEventBundle.mockReturnValue(settledBundle({ realtimeDegraded: true }));
    useMilestoneClaim.mockReturnValue({
      milestoneReveal: {
        milestone: 7,
        streak: 7,
        card: PETS[0],
        tierFloor: null,
        duplicate: false,
      },
      claim: vi.fn(),
      dismiss: vi.fn(),
      claiming: false,
    });
    render(<PlayersPage />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});
