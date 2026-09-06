// The one exception to the vault's silence, pinned where it actually renders.
//
// The mystery slot is the only thing this app is allowed to say about secrets
// nobody has pulled, and it is only allowed in one exact shape: one tile at the
// end of an open set, never a second, never a number, and never on a set that has
// already been finished. Two of those three rules are invisible in the component
// itself — they live in the condition at the render site — so this is where they
// have to be held.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import PlayersPage from "./players.index";
import { EVENT_ID, makeBundle } from "@/test/fixtures";

const useCollectionTrophies = vi.fn();
const useMySecrets = vi.fn();

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

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle(),
    error: null,
    loading: false,
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  }),
}));

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
  useMilestoneClaim: () => ({ milestoneReveal: null, claim: vi.fn(), claiming: false }),
}));
vi.mock("@/hooks/use-my-collection", () => ({
  useMyCollection: () => ({
    collection: {},
    collectedCount: 0,
    ready: true,
    markCollected: vi.fn(),
  }),
}));

// Partial, because both of these modules export helpers the page calls as well as
// the hook it reads.
vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMemberSession: () => ({ participantId: ME }) };
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

beforeEach(() => {
  useMySecrets.mockReturnValue({ data: { cards: PETS, pulled: PETS.length } });
  useCollectionTrophies.mockReturnValue({ data: { trophies: [] } });
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
    // Excluding the shelf's own heading, which says the same word for a different
    // reason: that one names the panel, these name the cards.
    const chips = within(petsShelf())
      .getAllByText("Pets")
      .filter((el) => el.tagName !== "H2");
    expect(chips).toHaveLength(PETS.length);
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
