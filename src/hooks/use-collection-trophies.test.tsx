// Delivering a ceremony for a set that closed while you were looking elsewhere.
//
// The interesting behaviour is not "does a query fetch". It is the three ways
// this can go wrong on a real phone: a device seeing the app for the first time
// must not fire a ceremony for every set its owner finished last summer; a
// device that HAS been here must fire for the one that landed overnight; and
// neither may fire for a set the pack or trade screen has already celebrated
// with its own, better-timed reveal.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import type { CollectionTrophy } from "@/lib/collection-trophies";

const serverFnMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => serverFnMock,
}));

const memberSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member-token")>()),
  useMemberSession: () => memberSession(),
}));

// jsdom has no websocket and the suite must never reach Supabase. The channel is
// a shell: the watcher's correctness lives in the diff, not in the event.
vi.mock("@/integrations/supabase/client", () => {
  const channel: Record<string, unknown> = {
    on: () => channel,
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});

import { useCollectionTrophyWatcher } from "./use-collection-trophies";
import { markTrophiesCelebrated, setTrophySeen, trophyKey } from "@/lib/trophy-seen";

const ME = "p-me";
const THEM = "p-them";

const trophy = (participantId: string, collection: string): CollectionTrophy => ({
  participantId,
  collection,
  label: collection === "pets" ? "Pets" : "WAGs",
  size: 9,
  completedOn: "2026-08-24",
  via: "grant",
});

function watch(trophies: CollectionTrophy[]) {
  serverFnMock.mockResolvedValue({ trophies });
  const { wrapper } = createQueryWrapper();
  return renderHook(() => useCollectionTrophyWatcher(), { wrapper });
}

beforeEach(() => {
  serverFnMock.mockReset();
  memberSession.mockReturnValue({ participantId: ME });
  // Module value first, then storage: setTrophySeen writes through, so clearing
  // in the other order leaves the reset itself sitting under the key and every
  // "the watcher wrote nothing" assertion becomes untrue for the wrong reason.
  setTrophySeen({ primed: false, ids: [] });
  window.localStorage.clear();
});

describe("useCollectionTrophyWatcher", () => {
  it("says nothing on a device that has never been here", async () => {
    // The ceremony storm this exists to prevent: somebody installs the app in
    // August holding four finished sets, and gets four full-screen takeovers
    // before they can read the page.
    const { result } = watch([trophy(ME, "pets"), trophy(ME, "wags")]);
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    await waitFor(() => expect(window.localStorage.getItem("wwbh:trophy-seen")).not.toBeNull());
    expect(result.current.queue).toEqual([]);
  });

  it("fires for a set that arrived since this device last looked", async () => {
    // The grant case, which is the whole reason for this hook. It ran on the
    // commissioner's phone; nothing on the recipient's screen ever saw a
    // response.
    setTrophySeen({ primed: true, ids: [trophyKey(ME, "pets")] });
    const { result } = watch([trophy(ME, "pets"), trophy(ME, "wags")]);
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    expect(result.current.queue[0]).toMatchObject({ collection: "wags" });
  });

  it("does not replay one the pack screen already celebrated", async () => {
    // Both paths write to the same seen-set, which is what stops the response-
    // driven ceremony and this one landing on top of each other.
    markTrophiesCelebrated([trophyKey(ME, "pets")]);
    const { result } = watch([trophy(ME, "pets")]);
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(result.current.queue).toEqual([]);
  });

  it("leaves somebody else's finished set alone", async () => {
    setTrophySeen({ primed: true, ids: [] });
    const { result } = watch([trophy(THEM, "pets")]);
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(result.current.queue).toEqual([]);
  });

  it("waits for the member to hydrate before deciding anything", async () => {
    // useMemberSession reports null on the hydration render even for a claimed
    // member, and this query has no `enabled` gate — so the list lands first.
    // Priming in that window would mark the device seen with nothing in it, and
    // every trophy would fire the moment the token settled.
    memberSession.mockReturnValue(null);
    const { result } = watch([trophy(ME, "pets")]);
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(result.current.queue).toEqual([]);
    expect(window.localStorage.getItem("wwbh:trophy-seen")).toBeNull();
  });

  it("queues both sets a single trade can close", async () => {
    setTrophySeen({ primed: true, ids: [] });
    const { result } = watch([trophy(ME, "pets"), trophy(ME, "wags")]);
    await waitFor(() => expect(result.current.queue).toHaveLength(2));
  });

  it("drops the one on screen and moves to the next", async () => {
    setTrophySeen({ primed: true, ids: [] });
    const { result } = watch([trophy(ME, "pets"), trophy(ME, "wags")]);
    await waitFor(() => expect(result.current.queue).toHaveLength(2));
    result.current.shift();
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    expect(result.current.queue[0]).toMatchObject({ collection: "wags" });
  });

  it("marks a trophy celebrated before it is dismissed, not after", async () => {
    // A navigation mid-ceremony unmounts the host. Claimed on the way out, the
    // trophy would come back on every refetch for the rest of the season.
    setTrophySeen({ primed: true, ids: [] });
    const { result } = watch([trophy(ME, "pets")]);
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    expect(JSON.parse(window.localStorage.getItem("wwbh:trophy-seen")!).ids).toEqual([
      trophyKey(ME, "pets"),
    ]);
  });
});
