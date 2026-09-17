// The share link, and whether it actually opens anything.
//
// `?vs=` is a link dropped in the group chat: the recipient is meant to land on
// the left card with the head-to-head already up. Everything about that lives in
// one `comparing` flag, and the flag is seeded once at mount — which is not
// enough, because the card is locked on the first frame of every load while the
// collection is still being read. This pins the sheet across that settling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Route } from "./players.$id";
import { EVENT_ID, makeBundle, makeParticipant, resetFixtureIds, uuid } from "@/test/fixtures";

/**
 * The page off the route rather than off a default export.
 *
 * Every other route test in this folder imports its page as the module default,
 * and this one did too until the build objected: TanStack Router cannot
 * code-split an export it does not own, so a second export here pulled this
 * page — the second-largest route in the app — and everything it imports into
 * the entry bundle for every screen. On a phone-first app that is the wrong
 * trade for a test convenience. `createFileRoute` is mocked below, so `Route`
 * is the plain options object and `component` is the page itself.
 */
const PlayerCardPage = (Route as unknown as { component: () => ReactNode }).component;

const search = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>));
const params = vi.hoisted(() => vi.fn(() => ({ id: "" })));
const useMyCollection = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
    useCanGoBack: () => false,
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useSearch: () => search(),
      useParams: () => params(),
    }),
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

// The sheet itself is a vaul drawer and is not what is under test — what is
// under test is whether this page ever tells it to open.
const compareProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/components/card-compare", () => ({
  CardCompare: (props: Record<string, unknown>) => {
    compareProps.current = props;
    return <div data-testid="card-compare" data-open={String(props.open)} />;
  },
}));

const bundleRef = vi.hoisted(() => ({ current: null as ReturnType<typeof makeBundle> | null }));
vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: bundleRef.current,
    error: null,
    loading: false,
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  }),
}));

vi.mock("@/hooks/use-my-collection", () => ({
  useMyCollection: (...args: unknown[]) => useMyCollection(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventCardUrls: () => ({ data: undefined }),
  useEventCardBack: () => ({ data: undefined }),
  useEventPhotoUrls: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-card-pulls", () => ({ useCardPullCounts: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-collection-trophies", () => ({
  useCollectionTrophies: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-event-social", () => ({
  useEventSocial: () => ({ data: undefined, reactions: [], comments: [], degraded: false }),
  useEventAwards: () => ({ data: undefined, byParticipant: new Map() }),
}));
vi.mock("@/hooks/use-recent-acquisitions", () => ({
  useRecentAcquisitions: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-reveal-cue", () => ({ useRevealCue: () => ({ cue: null, seen: vi.fn() }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMemberSession: () => null };
});

vi.mock("@/lib/share-card", () => ({
  exportCardPng: vi.fn(async () => null),
  waitForPaint: vi.fn(async () => {}),
}));

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

/** Two players on the roster, so there is somebody to compare against. */
function setupRoster() {
  const alice = makeParticipant({
    running_order: 1,
    participant: { id: uuid(), name: "Alice", nickname: null },
  });
  const bob = makeParticipant({
    running_order: 2,
    participant: { id: uuid(), name: "Bob", nickname: null },
  });
  bundleRef.current = makeBundle({ participants: [alice, bob] });
  return { alice, bob };
}

/** The collection as it reads before and after the local store settles. */
function collectionOnce(ids: string[]) {
  const collection = Object.fromEntries(
    ids.map((cardId) => [cardId, { eventParticipantId: cardId, pulledAt: 1, count: 1 }]),
  );
  return {
    settling: { collection: {}, collectedCount: 0, ready: false, markCollected: vi.fn() },
    settled: { collection, collectedCount: ids.length, ready: true, markCollected: vi.fn() },
  };
}

describe("a card opened from a ?vs= link", () => {
  beforeEach(() => {
    resetFixtureIds();
    compareProps.current = null;
    search.mockReturnValue({});
    // The filmstrip scrolls the current card into view; jsdom has no scrollTo.
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollTo;
  });

  it("has the head-to-head up once the collection has settled", () => {
    // The bug: `locked` is true on the first committed frame of every load,
    // because useMyCollection reports nothing ready until its IndexedDB reads
    // come back. The lock-fallback effect fired on that frame and threw the
    // seed away, and nothing re-opened the sheet when the card unlocked — so
    // the recipient got an unlit chip and had to tap Compare themselves.
    const { alice, bob } = setupRoster();
    params.mockReturnValue({ id: alice.id });
    search.mockReturnValue({ vs: bob.id });
    const states = collectionOnce([alice.id, bob.id]);

    useMyCollection.mockReturnValue(states.settling);
    const { rerender } = render(<PlayerCardPage />);
    expect(screen.getByTestId("card-compare")).toHaveAttribute("data-open", "false");

    useMyCollection.mockReturnValue(states.settled);
    rerender(<PlayerCardPage />);

    expect(screen.getByTestId("card-compare")).toHaveAttribute("data-open", "true");
    // And with the opponent already picked, so it is the head-to-head rather
    // than the roster picker.
    expect(compareProps.current?.right).toMatchObject({ id: bob.id });
  });

  it("stays shut on a card this device does not hold", () => {
    // The rule the lock fallback exists for, unchanged: the sheet and the
    // greyed-out chip underneath it have to agree.
    const { alice, bob } = setupRoster();
    params.mockReturnValue({ id: alice.id });
    search.mockReturnValue({ vs: bob.id });
    const states = collectionOnce([bob.id]);

    useMyCollection.mockReturnValue(states.settling);
    const { rerender } = render(<PlayerCardPage />);
    useMyCollection.mockReturnValue(states.settled);
    rerender(<PlayerCardPage />);

    expect(screen.getByTestId("card-compare")).toHaveAttribute("data-open", "false");
  });

  it("stays shut with no ?vs= on the URL", () => {
    const { alice, bob } = setupRoster();
    params.mockReturnValue({ id: alice.id });
    const states = collectionOnce([alice.id, bob.id]);

    useMyCollection.mockReturnValue(states.settling);
    const { rerender } = render(<PlayerCardPage />);
    useMyCollection.mockReturnValue(states.settled);
    rerender(<PlayerCardPage />);

    expect(screen.getByTestId("card-compare")).toHaveAttribute("data-open", "false");
  });
});
