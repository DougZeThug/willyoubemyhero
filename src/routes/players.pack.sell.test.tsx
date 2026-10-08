// The pack summary's Sell, and which day it hands the hook.
//
// usePackSell finds the copy a pack minted by the day that pack was dealt, and the
// hook is tested with explicit days. This pins the other half: that the route hands
// it the day from its own record of the deal, not nothing and not a guess.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import PackPage from "./players.pack";
import { EVENT_ID, makeBundle } from "@/test/fixtures";

const openPack = vi.hoisted(() => vi.fn());
const loadPackState = vi.hoisted(() => vi.fn());
const sellSlot = vi.hoisted(() => vi.fn());

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
vi.mock("@/hooks/use-pack-sell", () => ({ usePackSell: () => sellSlot }));

vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clearMemberToken: vi.fn(),
    useMemberSession: () => ({
      participantId: "me",
      expiresAt: Number.MAX_SAFE_INTEGER,
      token: "m.me.x.y",
      name: null,
    }),
  };
});

vi.mock("@/hooks/use-daily-secret", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useSecretActor: () => "m:me", useMySecrets: () => ({ data: undefined }) };
});

vi.mock("@/lib/device-id", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, deviceId: () => "device", usePackIdentity: () => "m:me" };
});

vi.mock("@/lib/card-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPackState, savePackState: vi.fn(() => Promise.resolve()) };
});

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    // Dust switched on: a sell value only shows when the commissioner allows it.
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true, dust_enabled: true },
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

beforeEach(async () => {
  const { todayKey } =
    await vi.importActual<typeof import("@/lib/card-collection")>("@/lib/card-collection");
  // A duplicate gold the server decided, already turned over: the summary offers it.
  loadPackState.mockReset().mockResolvedValue({
    dayKey: todayKey(),
    identity: "m:me",
    ids: [CARD],
    cards: [{ kind: "roster", id: CARD, heldBefore: 1 }],
    revealed: [0],
    cursor: 1,
  });
  openPack.mockReset().mockResolvedValue({
    ok: true,
    day: todayKey(),
    fresh: false,
    packsOpened: 1,
    cards: [
      { kind: "roster", id: CARD, edition: "gold", heldBefore: 1, editionBefore: "standard" },
    ],
  });
  sellSlot.mockReset().mockResolvedValue({ ok: true, awarded: 40 });
});

describe("selling from the pack summary", () => {
  it("hands the hook the day the pack on screen was dealt", async () => {
    const { todayKey } =
      await vi.importActual<typeof import("@/lib/card-collection")>("@/lib/card-collection");
    render(<PackPage />);

    await userEvent.click(await screen.findByRole("button", { name: /^sell for/i }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^sell for/i }));

    await waitFor(() => expect(sellSlot).toHaveBeenCalledTimes(1));
    const [slot, edition, packDay] = sellSlot.mock.calls[0];
    expect(slot).toMatchObject({ kind: "roster", id: CARD });
    expect(edition).toBe("gold");
    expect(packDay).toBe(todayKey());
  });
});
