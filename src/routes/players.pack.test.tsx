// What the pack screen tells `useMyCollection` about the combine.
//
// The hook cannot settle a member's collection without an event id, so it has to
// be told when one is never coming — and the pack page got that argument wrong
// for longer than anywhere else. It passed the flag it renders `FeedError` from,
// which only names a read that BROKE. Out of season the read succeeds and simply
// answers "no combine on", so the flag stayed false, `mine.ready` never turned
// true, and the Collected counter sat dashed for good on a screen the Pack tab
// still links to between combines.
//
// Pinned at the call site rather than in the hook, because the hook has always
// handled both cases correctly — only its caller could not tell them apart.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import PackPage from "./players.pack";
import { EVENT_ID, makeBundle } from "@/test/fixtures";

const useEventBundle = vi.fn();
const useMyCollection = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    getQueryData: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-event-bundle", () => ({ useEventBundle: () => useEventBundle() }));
vi.mock("@/hooks/use-my-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMyCollection: (...args: unknown[]) => useMyCollection(...args) };
});

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventCardUrls: () => ({ data: undefined }),
  useEventCardBack: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-guest-session", () => ({ useEnsureGuestSession: () => {} }));
vi.mock("@/hooks/use-daily-secret", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSecretActor: () => "m:me",
    useMySecrets: () => ({ data: undefined }),
  };
});
vi.mock("@/hooks/use-pack-status", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, usePackStatus: () => ({ data: undefined }) };
});
vi.mock("@/hooks/use-streak", () => ({ useStreakStatus: () => ({ data: null }) }));
vi.mock("@/hooks/use-card-pulls", () => ({ useCardPullCounts: () => ({ data: undefined }) }));

/** What `useMyCollection` was handed as its "no event is coming" argument. */
const noEventComingArg = () => useMyCollection.mock.calls.at(-1)?.[2];

beforeEach(() => {
  useEventBundle.mockReset();
  useMyCollection.mockReset().mockReturnValue({
    collection: {},
    collectedCount: 0,
    packsOpened: 0,
    dupes: 0,
    firstPackOn: null,
    ready: true,
    isMember: true,
    markCollected: vi.fn(),
  });
});

const bundle = (over: Record<string, unknown>) => ({
  event: undefined,
  bundle: undefined,
  loading: false,
  error: null,
  failedTables: [] as string[],
  realtimeDegraded: false,
  refetch: vi.fn(async () => {}),
  ...over,
});

describe("the pack screen's reconcile unblock", () => {
  it("tells the hook no event is coming when there is no combine on", () => {
    // The whole bug: a SUCCESSFUL read that answers "nothing on". Without this
    // the stats query never runs and never settles, so the counter reads "— / 0"
    // for as long as the page is open.
    useEventBundle.mockReturnValue(bundle({}));
    render(<PackPage />);
    expect(noEventComingArg()).toBe(true);
  });

  it("still tells it so when the read broke outright", () => {
    useEventBundle.mockReturnValue(bundle({ error: new Error("offline") }));
    render(<PackPage />);
    expect(noEventComingArg()).toBe(true);
  });

  // The roster coalesced to `[]` by a failed read — the case an error check
  // alone cannot see, and the reason `failedTables` exists.
  it("still tells it so when the roster came back empty from a failure", () => {
    useEventBundle.mockReturnValue(
      bundle({
        event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
        bundle: makeBundle(),
        failedTables: ["event_participants"],
      }),
    );
    render(<PackPage />);
    expect(noEventComingArg()).toBe(true);
  });

  it("says nothing of the sort while the answer is still on its way", () => {
    // An id may yet arrive. Unblocking here would settle the collection against
    // no server answer at all and state a count that is about to change.
    useEventBundle.mockReturnValue(bundle({ loading: true }));
    render(<PackPage />);
    expect(noEventComingArg()).toBe(false);
  });

  it("says nothing of the sort once a combine is on", () => {
    useEventBundle.mockReturnValue(
      bundle({
        event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
        bundle: makeBundle(),
      }),
    );
    render(<PackPage />);
    expect(noEventComingArg()).toBe(false);
  });
});
