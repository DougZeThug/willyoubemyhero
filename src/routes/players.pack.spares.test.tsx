// What a landed pack refreshes, for the Shop's sake.
//
// Today's pull is a spare the moment it lands: the Shop burns and sells it the
// same day. But the Shop's list is getTradeSpares, cached under dustSparesKey
// (and the Trading Post's under tradeSparesKey), and a list cached before the
// pack opened does not have today's cards on it. The pack screen is the one
// place that knows they arrived, so it has to say so — for a member, who has
// spares, and not for a guest, who has none.
//
// Its own file because it needs the open to SUCCEED and an identity that can be
// either, where players.pack.claim-reject.test.tsx needs it refused.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import PackPage from "./players.pack";
import { dustSparesKey, tradeSparesKey } from "@/hooks/use-trades";
import { EVENT_ID, makeBundle } from "@/test/fixtures";

const who = vi.hoisted(() => ({ member: true }));
const openPack = vi.hoisted(() => vi.fn());
const loadPackState = vi.hoisted(() => vi.fn());
const invalidateQueries = vi.hoisted(() => vi.fn(() => Promise.resolve()));

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
    invalidateQueries,
    getQueryData: vi.fn(),
  }),
}));

vi.mock("@/lib/pack.functions", () => ({ openPack }));

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
  return {
    ...actual,
    deviceId: () => "device",
    usePackIdentity: () => (who.member ? "m:me" : "d:device"),
  };
});

vi.mock("@/lib/card-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPackState, savePackState: vi.fn(() => Promise.resolve()) };
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
// The key builders stay real: the refresh after an open calls every one of them,
// and a mock without them throws partway through and never reaches the spares.
vi.mock("@/hooks/use-streak", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useStreakStatus: () => ({ data: null }) };
});
vi.mock("@/hooks/use-card-pulls", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useCardPullCounts: () => ({ data: undefined }) };
});

/** Every key the screen asked to refresh, stringified so they compare by value. */
const keys = () =>
  (invalidateQueries.mock.calls as unknown as [{ queryKey: unknown }][]).map(([f]) =>
    JSON.stringify(f.queryKey),
  );

/** Today's pack, already dealt to whoever the phone is; the resume asks for it. */
async function dealtTo(identity: string) {
  const { todayKey } =
    await vi.importActual<typeof import("@/lib/card-collection")>("@/lib/card-collection");
  loadPackState.mockReset().mockResolvedValue({
    dayKey: todayKey(),
    identity,
    ids: ["ep-1"],
    cards: [{ kind: "roster", id: "ep-1" }],
    revealed: [],
    cursor: 0,
  });
  openPack.mockReset().mockResolvedValue({
    ok: true,
    day: todayKey(),
    fresh: false,
    packsOpened: 1,
    cards: [{ kind: "roster", id: "ep-1", edition: "gold", heldBefore: 1, editionBefore: null }],
  });
}

beforeEach(() => {
  invalidateQueries.mockClear();
});

describe("a pack that lands", () => {
  it("refreshes both of a member's spares lists, so the Shop sees today's pull", async () => {
    who.member = true;
    await dealtTo("m:me");
    render(<PackPage />);

    await waitFor(() => expect(keys()).toContain(JSON.stringify(dustSparesKey("me"))));
    expect(keys()).toContain(JSON.stringify(tradeSparesKey("me")));
    expect(openPack).toHaveBeenCalledTimes(1);
  });

  it("refreshes no spares list for a guest, who has none", async () => {
    who.member = false;
    await dealtTo("d:device");
    render(<PackPage />);

    await waitFor(() => expect(openPack).toHaveBeenCalledTimes(1));
    // The rest of the refresh still happens; only the member-keyed half is skipped.
    await waitFor(() => expect(keys().length).toBeGreaterThan(0));
    expect(keys().some((k) => k.includes("spares"))).toBe(false);
  });
});
