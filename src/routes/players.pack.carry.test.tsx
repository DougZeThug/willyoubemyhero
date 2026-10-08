// A guest's pack, carried across a claim made in another tab, with a card in the air.
//
// `identity` flips under a pack that is already on the stand. The save effect will
// not write a pack under an identity it was not dealt to, so a card turned in that
// window never reaches the stored row — and the deferred resume that follows the
// reveal reads that row back. It used to take the row's word for it: the card
// turned face-down again, and because `carriedFromRef` is only learned from the
// row, the reveal that had just run never filed it either. `useMyCollection` then
// pruned a card the guest had really pulled.
//
// Its own file because it needs the identity to MOVE, where the other pack suites
// pin it for the whole test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import PackPage from "./players.pack";
import { EVENT_ID, makeBundle } from "@/test/fixtures";

const who = vi.hoisted(() => ({ identity: "d:device", member: false }));
const openPack = vi.hoisted(() => vi.fn());
const adoptCollection = vi.hoisted(() => vi.fn());
const loadPackState = vi.hoisted(() => vi.fn());
const savePackState = vi.hoisted(() =>
  vi.fn((_state: Record<string, unknown>) => Promise.resolve()),
);
const addUnrecorded = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const retireUnrecorded = vi.hoisted(() => vi.fn(() => Promise.resolve()));

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
    invalidateQueries: vi.fn(() => Promise.resolve()),
    getQueryData: vi.fn(),
  }),
}));

vi.mock("@/lib/pack.functions", () => ({ openPack }));
vi.mock("@/lib/card-pulls.functions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  adoptCollection,
}));

vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clearMemberToken: vi.fn(),
    useMemberSession: () =>
      who.member
        ? { participantId: "me", expiresAt: Number.MAX_SAFE_INTEGER, token: "m.me.x.y", name: null }
        : null,
  };
});

vi.mock("@/hooks/use-daily-secret", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSecretActor: () => (who.member ? "m:me" : "g:guest"),
    useMySecrets: () => ({ data: undefined }),
  };
});

vi.mock("@/lib/device-id", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, deviceId: () => "device", usePackIdentity: () => who.identity };
});

vi.mock("@/lib/card-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadPackState,
    savePackState,
    addUnrecorded,
    retireUnrecorded,
    collectCard: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle(),
    loading: false,
    error: null,
    failedTables: [] as string[],
    realtimeDegraded: false,
    refetch: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock("@/hooks/use-my-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMyCollection: () => ({
      collection: {},
      collectedCount: 0,
      packsOpened: 0,
      dupes: 0,
      firstPackOn: null,
      ready: true,
      isMember: true,
      markCollected: vi.fn(),
    }),
  };
});
vi.mock("@/hooks/use-photo-urls", () => ({
  useEventCardUrls: () => ({ data: undefined }),
  useEventCardBack: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-guest-session", () => ({ useEnsureGuestSession: vi.fn() }));
vi.mock("@/hooks/use-pack-status", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, usePackStatus: () => ({ data: undefined }) };
});
vi.mock("@/hooks/use-streak", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useStreakStatus: () => ({ data: null }) };
});
vi.mock("@/hooks/use-card-pulls", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useCardPullCounts: () => ({ data: undefined }) };
});

const CARD = "ep-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function row(over: Record<string, unknown>) {
  const { todayKey } =
    await vi.importActual<typeof import("@/lib/card-collection")>("@/lib/card-collection");
  return {
    dayKey: todayKey(),
    ids: [CARD],
    cards: [{ kind: "roster", id: CARD, heldBefore: 0 }],
    revealed: [] as number[],
    cursor: 0,
    ...over,
  };
}

/** The row a claim leaves behind: re-keyed to the member, carried from the guest. */
const carriedRow = (over: Record<string, unknown> = {}) =>
  row({ identity: "m:me", carriedFrom: "d:device", carriedAdopted: [], ...over });

beforeEach(async () => {
  who.identity = "d:device";
  who.member = false;
  for (const m of [openPack, adoptCollection, loadPackState, savePackState, addUnrecorded])
    m.mockClear();
  retireUnrecorded.mockClear();
  const { todayKey } =
    await vi.importActual<typeof import("@/lib/card-collection")>("@/lib/card-collection");
  openPack.mockReset().mockResolvedValue({
    ok: true,
    day: todayKey(),
    fresh: false,
    packsOpened: 1,
    cards: [{ kind: "roster", id: CARD, edition: "standard", heldBefore: 0, editionBefore: null }],
  });
  adoptCollection.mockReset().mockResolvedValue({ adopted: 1 });
});

/** What the last save wrote, for the fields these tests are about. */
const lastSave = () => savePackState.mock.calls.at(-1)?.[0];

describe("a card turned while a claim in another tab carries the pack", () => {
  it("stays turned, and is filed for the member", async () => {
    loadPackState.mockResolvedValue(await row({ identity: "d:device" }));
    const { rerender } = render(<PackPage />);
    const revealAll = await screen.findByRole("button", { name: /reveal all/i });
    await waitFor(() => expect(revealAll).toBeEnabled());
    await userEvent.click(revealAll);

    // Mid-hold: the card is in the air and still face-down. The claim lands in
    // the other tab — the identity moves, and the row is about to be re-keyed.
    await sleep(600);
    expect(adoptCollection).not.toHaveBeenCalled();
    who.identity = "m:me";
    who.member = true;
    // The carry has landed by the time the reveal lets go: the row the deferred
    // resume reads is the member's, built from a snapshot that predates the card.
    loadPackState.mockResolvedValue(await carriedRow());
    rerender(<PackPage />);

    await waitFor(() => expect(adoptCollection).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(adoptCollection).toHaveBeenCalledWith({ data: { eventParticipantIds: [CARD] } });
    expect(addUnrecorded).toHaveBeenCalledWith(
      expect.objectContaining({ identity: "m:me", ids: [CARD] }),
    );
    // And the row it writes back still has the card turned, and knows it is filed.
    await waitFor(() =>
      expect(lastSave()).toMatchObject({
        identity: "m:me",
        revealed: [0],
        carriedFrom: "d:device",
        carriedAdopted: [CARD],
      }),
    );
  }, 15_000);
});

describe("resuming a carried pack", () => {
  it("files a card that is already face-up and was in no adoption", async () => {
    who.identity = "m:me";
    who.member = true;
    loadPackState.mockResolvedValue(await carriedRow({ revealed: [0] }));
    render(<PackPage />);

    await waitFor(() => expect(adoptCollection).toHaveBeenCalledTimes(1));
    expect(adoptCollection).toHaveBeenCalledWith({ data: { eventParticipantIds: [CARD] } });
    await waitFor(() => expect(retireUnrecorded).toHaveBeenCalledWith([CARD]));
  });

  it("leaves alone a card the claim's adoption already took", async () => {
    who.identity = "m:me";
    who.member = true;
    loadPackState.mockResolvedValue(await carriedRow({ revealed: [0], carriedAdopted: [CARD] }));
    render(<PackPage />);

    await waitFor(() => expect(openPack).toHaveBeenCalled());
    await sleep(100);
    expect(adoptCollection).not.toHaveBeenCalled();
  });

  it("files nothing for a pack nobody carried", async () => {
    who.identity = "m:me";
    who.member = true;
    loadPackState.mockResolvedValue(await row({ identity: "m:me", revealed: [0] }));
    render(<PackPage />);

    await waitFor(() => expect(openPack).toHaveBeenCalled());
    await sleep(100);
    expect(adoptCollection).not.toHaveBeenCalled();
  });

  it("does not file a face-down card", async () => {
    who.identity = "m:me";
    who.member = true;
    loadPackState.mockResolvedValue(await carriedRow());
    render(<PackPage />);

    await waitFor(() => expect(openPack).toHaveBeenCalled());
    await sleep(100);
    expect(adoptCollection).not.toHaveBeenCalled();
  });
});
