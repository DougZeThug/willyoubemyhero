// Cashing a streak milestone.
//
// This moved out of players.pack.tsx because the reward is now claimable from
// home as well, and two copies of it would be two ladders — one of which would
// quietly start paying twice. Everything here was already load-bearing there:
// the two latches, the highest-rung-first rule, and a reveal that belongs to
// whoever was holding the phone when it was claimed.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import { STREAK_MILESTONES } from "@/lib/streaks";
import type { StreakStatus } from "@/lib/streaks.functions";

const claimFn = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => claimFn,
}));

import { useMilestoneClaim } from "./use-milestone-claim";

const CARD = { id: "s-1", name: "The Gazebo", tier: "rare" } as never;

function streak(over: Partial<StreakStatus> = {}): StreakStatus {
  const current = over.current ?? 14;
  return {
    kind: "member",
    current,
    startedOn: "2026-08-21",
    lastOpenedOn: "2026-09-04",
    openedToday: true,
    today: "2026-09-04",
    canClaim: true,
    milestones: STREAK_MILESTONES.map((m) => ({
      days: m.days,
      label: m.label,
      blurb: m.blurb,
      tierFloor: m.tierFloor,
      earned: current >= m.days,
      claimed: false,
    })),
    ...over,
  };
}

function mount(actor: string | null, status: StreakStatus | null) {
  const { wrapper } = createQueryWrapper();
  return renderHook(({ a, s }) => useMilestoneClaim(a, s), {
    wrapper,
    initialProps: { a: actor, s: status },
  });
}

describe("which rung is offered", () => {
  it("offers nothing before a streak has been answered for", () => {
    const { result } = mount("m:alice", null);
    expect(result.current.claimable).toBeNull();
  });

  it("offers the HIGHEST rung earned and not yet taken", () => {
    // Highest rather than lowest, so a 14-day streak claiming late collects the
    // big one first and the rest follow on the next taps, instead of making
    // somebody work up the ladder.
    const { result } = mount("m:alice", streak({ current: 14 }));
    expect(result.current.claimable?.days).toBe(14);
  });

  it("skips a rung already claimed", () => {
    const s = streak({ current: 14 });
    s.milestones = s.milestones.map((m) => (m.days === 14 ? { ...m, claimed: true } : m));
    const { result } = mount("m:alice", s);
    expect(result.current.claimable?.days).toBe(7);
  });

  it("offers nothing on a run that has reached no rung", () => {
    const { result } = mount("m:alice", streak({ current: 2 }));
    expect(result.current.claimable).toBeNull();
  });
});

describe("claiming", () => {
  it("opens the reveal with what the LADDER promised, not what the server said", () => {
    // So the reveal prints the rung's floor even if an older server is still
    // answering.
    claimFn.mockReset();
    claimFn.mockResolvedValue({
      ok: true,
      milestone: 7,
      streak: 7,
      duplicate: false,
      card: CARD,
    });
    const { result } = mount("m:alice", streak({ current: 7 }));
    return act(async () => {
      await result.current.claim(7);
    }).then(() => {
      expect(result.current.milestoneReveal).toMatchObject({
        milestone: 7,
        tierFloor: "rare",
        duplicate: false,
      });
    });
  });

  it("refuses a second tap racing the first to the same rung", async () => {
    claimFn.mockReset();
    let release: (v: unknown) => void = () => {};
    claimFn.mockImplementation(() => new Promise((r) => (release = r)));
    const { result } = mount("m:alice", streak({ current: 3 }));
    await act(async () => {
      void result.current.claim(3);
      void result.current.claim(3);
    });
    expect(claimFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ ok: true, milestone: 3, streak: 3, duplicate: false, card: CARD });
    });
  });

  it("does not offer the rung again when the query refetches still showing it unclaimed", async () => {
    // The real shape of the race: the claim lands, the status refetches on focus
    // BEFORE the server's write is reflected in it, and the rung comes back
    // earned-and-unclaimed. `claimedRef` is what stops the button re-arming and
    // the ceremony firing a second time over the top of the first.
    claimFn.mockReset();
    claimFn.mockResolvedValue({ ok: true, milestone: 3, streak: 3, duplicate: false, card: CARD });
    const stale = streak({ current: 3 });
    const { result, rerender } = mount("m:alice", stale);
    await act(async () => {
      await result.current.claim(3);
    });
    act(() => result.current.dismiss());

    // The refetch: a NEW object, same run, rung still reading unclaimed.
    rerender({ a: "m:alice", s: streak({ current: 3 }) });
    expect(result.current.claimable).toBeNull();
    expect(result.current.milestoneReveal).toBeNull();
  });

  it("offers the rung again once the run has been broken and rebuilt", async () => {
    // A rebuilt run is a NEW run and every rung is earnable on it again — the
    // claim is keyed on the day the run started, which is what keeps the ladder
    // re-earnable. A latch keyed on days alone remembered the old run and
    // suppressed a button the server was correctly offering.
    claimFn.mockReset();
    claimFn.mockResolvedValue({ ok: true, milestone: 3, streak: 3, duplicate: false, card: CARD });
    const { result, rerender } = mount("m:alice", streak({ current: 3 }));
    await act(async () => {
      await result.current.claim(3);
    });
    expect(result.current.claimable).toBeNull();

    rerender({ a: "m:alice", s: streak({ current: 3, startedOn: "2026-09-20" }) });
    await waitFor(() => expect(result.current.claimable?.days).toBe(3));
  });

  it("asks again when the server says the rung is already collected", async () => {
    // Another device took it, or the first attempt's response was lost. Either
    // way everything this screen believes about the ladder is a response behind.
    claimFn.mockReset();
    claimFn.mockResolvedValue({ ok: false, reason: "claimed" });
    const { client } = createQueryWrapper();
    void client;
    const { result } = mount("m:alice", streak({ current: 3 }));
    await act(async () => {
      await result.current.claim(3);
    });
    expect(result.current.claimError).toMatch(/already collected/i);
  });

  it("says every refusal on the button and never as a toast", async () => {
    // A toast announces the reward to whoever is glancing at the phone over
    // your shoulder.
    const cases: [string, RegExp][] = [
      ["claimed", /already collected/i],
      ["account_required", /sign in first/i],
      ["not_earned", /isn't there yet/i],
      ["unavailable", /nothing to give out/i],
    ];
    for (const [reason, message] of cases) {
      claimFn.mockReset();
      claimFn.mockResolvedValue({ ok: false, reason });
      const { result } = mount("m:alice", streak({ current: 3 }));
      await act(async () => {
        await result.current.claim(3);
      });
      expect(result.current.claimError).toMatch(message);
      expect(result.current.milestoneReveal).toBeNull();
    }
  });

  it("says so when the tap never left the phone", async () => {
    claimFn.mockReset();
    claimFn.mockRejectedValue(new Error("offline"));
    const { result } = mount("m:alice", streak({ current: 3 }));
    await act(async () => {
      await result.current.claim(3);
    });
    expect(result.current.claimError).toMatch(/no signal/i);
  });
});

describe("a phone changing hands", () => {
  it("takes the previous person's reveal off the screen", async () => {
    // Real in this league. The next person's milestones are their own, and a
    // reveal left up would be showing them somebody else's card.
    claimFn.mockReset();
    claimFn.mockResolvedValue({ ok: true, milestone: 3, streak: 3, duplicate: false, card: CARD });
    const s = streak({ current: 3 });
    const { result, rerender } = mount("m:alice", s);
    await act(async () => {
      await result.current.claim(3);
    });
    expect(result.current.milestoneReveal).not.toBeNull();

    rerender({ a: "m:bob", s });
    await waitFor(() => expect(result.current.milestoneReveal).toBeNull());
    // And the latch is re-armed, so Bob's own rung is offered rather than
    // swallowed by Alice's claim.
    expect(result.current.claimable?.days).toBe(3);
  });
});
