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

// The priming gate. Real in the app, mocked here so a test can hold the device
// in the "we do not know who this is yet" window on purpose rather than by
// winning a race with a mount effect.
const packIdentity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/device-id", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/device-id")>()),
  usePackIdentity: () => packIdentity(),
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
import {
  carryTrophySeen,
  markTrophiesCelebrated,
  setTrophySeen,
  trophyKey,
} from "@/lib/trophy-seen";

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
  packIdentity.mockReturnValue(`m:${ME}`);
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

  it("waits for the device to hydrate before deciding anything", async () => {
    // useMemberSession reports null on the hydration render even for a claimed
    // member, and this query has no `enabled` gate — so the list lands first.
    // Priming in that window would mark the device seen with nothing in it, and
    // every trophy would fire the moment the token settled. usePackIdentity is
    // null until the browser has answered, which is what closes that window.
    memberSession.mockReturnValue(null);
    packIdentity.mockReturnValue(null);
    const { result } = watch([trophy(ME, "pets")]);
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(result.current.queue).toEqual([]);
    expect(window.localStorage.getItem("wwbh:trophy-seen")).toBeNull();
  });

  it("primes a guest silently, so the set they finish is still celebrated", async () => {
    // The bug: a guest never primed, because the watcher waited on a participant
    // id they do not have. Claiming banks their finished set through
    // claim_guest_secrets — and that claim WAS the first priming pass, so it
    // swallowed the ceremony on the one path where it is most earned.
    memberSession.mockReturnValue(null);
    packIdentity.mockReturnValue("d:device-1");
    const guest = watch([]);
    await waitFor(() =>
      expect(window.localStorage.getItem("wwbh:trophy-seen")).toContain('"primed":true'),
    );
    expect(guest.result.current.queue).toEqual([]);
    guest.unmount();

    // They claim: the token lands, and the trophy banked by the claim is new to
    // a device that has already been through its priming pass.
    memberSession.mockReturnValue({ participantId: ME });
    packIdentity.mockReturnValue(`m:${ME}`);
    const member = watch([trophy(ME, "pets")]);
    await waitFor(() => expect(member.result.current.queue).toHaveLength(1));
    expect(member.result.current.queue[0]).toMatchObject({ collection: "pets" });
  });

  it("does not replay a set the guest already celebrated before claiming", async () => {
    // The other half of the guest path. B-13's fix stopped the ceremony being
    // swallowed; this stops it being shown twice. The pack screen fires it there
    // and then, marked under the only name the device has for a guest — and the
    // claim banks the trophy under a participant id the watcher then finds
    // uncelebrated. carryTrophySeen translates the key at claim time.
    const DEVICE = "d:device-1";
    memberSession.mockReturnValue(null);
    packIdentity.mockReturnValue(DEVICE);
    const guest = watch([]);
    await waitFor(() =>
      expect(window.localStorage.getItem("wwbh:trophy-seen")).toContain('"primed":true'),
    );
    // The pack screen's own ceremony, keyed on the guest's pack identity.
    markTrophiesCelebrated([trophyKey(DEVICE, "pets")]);
    guest.unmount();

    // They claim. The trophy lands under the participant, and the carry is what
    // makes it already-seen.
    carryTrophySeen(DEVICE, ME);
    memberSession.mockReturnValue({ participantId: ME });
    packIdentity.mockReturnValue(`m:${ME}`);
    const member = watch([trophy(ME, "pets")]);
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(member.result.current.queue).toEqual([]);
  });

  it("still fires for a set the guest never saw a ceremony for", async () => {
    // The carry must not turn into a blanket "this member has seen everything".
    // A set banked by a grant while they were a guest has had no ceremony, and
    // still deserves one.
    const DEVICE = "d:device-1";
    setTrophySeen({ primed: true, ids: [trophyKey(DEVICE, "pets")] });
    carryTrophySeen(DEVICE, ME);
    const { result } = watch([trophy(ME, "pets"), trophy(ME, "wags")]);
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    expect(result.current.queue[0]).toMatchObject({ collection: "wags" });
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
