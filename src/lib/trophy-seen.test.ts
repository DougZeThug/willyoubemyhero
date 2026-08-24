import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  markTrophiesCelebrated,
  setTrophySeen,
  trophyKey,
  uncelebratedTrophies,
  useTrophySeen,
  type TrophySeen,
} from "./trophy-seen";

const ME = "alice";
const THEM = "bob";
const KEY = "wwbh:trophy-seen";

const trophy = (participantId: string, collection: string) => ({ participantId, collection });

const seen = (over: Partial<TrophySeen> = {}): TrophySeen => ({ primed: true, ids: [], ...over });

/** What is actually on the phone. */
const stored = (): unknown => JSON.parse(window.localStorage.getItem(KEY) ?? "null");

/** What the module hands a component, which is the thing that matters. */
function live(): TrophySeen {
  return renderHook(() => useTrophySeen()).result.current;
}

beforeEach(() => {
  window.localStorage.clear();
  // The module value too, not just storage: the writes deliberately trust their
  // own cache over a re-read, so a test that only cleared storage would leak.
  setTrophySeen({ primed: false, ids: [] });
});

describe("trophyKey", () => {
  it("keys on the person as well as the set", () => {
    // A phone gets passed around at a party. Keyed on the collection alone,
    // whoever looked first would swallow the other's ceremony.
    expect(trophyKey(ME, "pets")).not.toBe(trophyKey(THEM, "pets"));
  });
});

describe("uncelebratedTrophies", () => {
  it("keeps only mine, and only the ones not yet shown", () => {
    const rows = [trophy(ME, "pets"), trophy(ME, "wags"), trophy(THEM, "cornhole")];
    expect(uncelebratedTrophies(rows, ME, seen({ ids: [trophyKey(ME, "wags")] }))).toEqual([
      trophy(ME, "pets"),
    ]);
  });

  it("is empty while the member has not hydrated", () => {
    // The case that decides whether this feature works at all. useMemberSession
    // reports null on the SSR and hydration renders even for a claimed member,
    // and the trophy query has no `enabled` gate — so the list routinely lands
    // first. Answering "none of these are yours" here is what stops the watcher
    // priming against somebody else's shelf.
    expect(uncelebratedTrophies([trophy(ME, "pets")], null, seen())).toEqual([]);
    expect(uncelebratedTrophies([trophy(ME, "pets")], undefined, seen())).toEqual([]);
  });

  it("never offers somebody else's trophy", () => {
    expect(uncelebratedTrophies([trophy(THEM, "pets")], ME, seen())).toEqual([]);
  });
});

describe("markTrophiesCelebrated", () => {
  it("adds to what is already there rather than replacing it", () => {
    markTrophiesCelebrated([trophyKey(ME, "pets")]);
    markTrophiesCelebrated([trophyKey(ME, "wags")]);
    const rows = [trophy(ME, "pets"), trophy(ME, "wags"), trophy(ME, "cornhole")];
    expect(uncelebratedTrophies(rows, ME, live())).toEqual([trophy(ME, "cornhole")]);
  });

  it("primes the device, because celebrating is being here", () => {
    // Otherwise a phone whose only trophy came through the pack screen would
    // still count as fresh, and the next seeding pass would swallow a genuinely
    // new one.
    expect(live().primed).toBe(false);
    markTrophiesCelebrated([trophyKey(ME, "pets")]);
    expect(live().primed).toBe(true);
  });

  it("does nothing at all for an empty list", () => {
    markTrophiesCelebrated([]);
    expect(live().primed).toBe(false);
  });
});

describe("setTrophySeen", () => {
  it("survives a page load", () => {
    setTrophySeen({ primed: true, ids: [trophyKey(ME, "pets")] });
    expect(stored()).toEqual({ primed: true, ids: [trophyKey(ME, "pets")] });
  });

  it("skips the write when nothing changed", () => {
    // The watcher calls this on every data settle, and a focus refetch happens
    // several times a minute. Without the guard each one rewrites storage and
    // wakes every listener.
    setTrophySeen({ primed: true, ids: [trophyKey(ME, "pets")] });
    let events = 0;
    window.addEventListener("wwbh:trophy-seen-changed", () => (events += 1));
    setTrophySeen({ primed: true, ids: [trophyKey(ME, "pets")] });
    expect(events).toBe(0);
    setTrophySeen({ primed: true, ids: [trophyKey(ME, "pets"), trophyKey(ME, "wags")] });
    expect(events).toBe(1);
  });

  it("de-duplicates", () => {
    setTrophySeen({ primed: true, ids: [trophyKey(ME, "pets"), trophyKey(ME, "pets")] });
    expect(live().ids).toEqual([trophyKey(ME, "pets")]);
  });
});

describe("useTrophySeen", () => {
  it("picks up what another tab wrote", () => {
    const { result } = renderHook(() => useTrophySeen());
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ primed: true, ids: [trophyKey(ME, "pets")] }),
    );
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current).toEqual({ primed: true, ids: [trophyKey(ME, "pets")] });
  });

  it("reads junk under its key as a fresh device", () => {
    // The safe direction, and the reason `primed` is checked with `=== true`
    // rather than for truthiness. Reading a corrupt value as primed would swallow
    // every ceremony on that phone forever; reading it as fresh costs one silent
    // seeding pass.
    const { result } = renderHook(() => useTrophySeen());
    for (const junk of ["not json", JSON.stringify({ primed: "yes", ids: 4 })]) {
      window.localStorage.setItem(KEY, junk);
      act(() => {
        window.dispatchEvent(new Event("storage"));
      });
      expect(result.current).toEqual({ primed: false, ids: [] });
    }
  });
});
