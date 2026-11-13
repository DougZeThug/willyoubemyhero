import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIdSet } from "@/hooks/use-id-set";
import { useKeyedQueue } from "@/hooks/use-keyed-queue";

describe("useIdSet", () => {
  it("tracks several ids at once and removes only the one that finished", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => {
      result.current.add("a");
      result.current.add("b");
    });
    expect(result.current.has("a") && result.current.has("b")).toBe(true);
    act(() => result.current.remove("a"));
    expect(result.current.has("a")).toBe(false);
    expect(result.current.has("b")).toBe(true);
  });

  it("toggles an id in and out", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => result.current.toggle("a"));
    expect(result.current.has("a")).toBe(true);
    act(() => result.current.toggle("a"));
    expect(result.current.has("a")).toBe(false);
  });

  it("keeps `has` stable when an add or remove changes nothing", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => result.current.add("a"));
    const has = result.current.has;
    act(() => {
      result.current.add("a");
      result.current.remove("zzz");
    });
    expect(result.current.has).toBe(has);
  });
});

describe("useKeyedQueue", () => {
  it("runs a key's saves in order and clears pending only after the last", async () => {
    const { result } = renderHook(() => useKeyedQueue());
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const task = (name: string) => () =>
      new Promise<void>((resolve) => {
        order.push(`start ${name}`);
        gates.push(() => {
          order.push(`end ${name}`);
          resolve();
        });
      });

    act(() => {
      result.current.enqueue("card", task("1"));
      result.current.enqueue("card", task("2"));
    });
    expect(result.current.pending("card")).toBe(true);
    await act(async () => {});
    expect(order).toEqual(["start 1"]);

    await act(async () => gates[0]!());
    expect(order).toEqual(["start 1", "end 1", "start 2"]);
    expect(result.current.pending("card")).toBe(true);

    await act(async () => gates[1]!());
    expect(result.current.pending("card")).toBe(false);
  });

  it("keeps the chain alive when a save throws", async () => {
    const { result } = renderHook(() => useKeyedQueue());
    let ran = false;
    await act(async () => {
      result.current.enqueue("k", () => Promise.reject(new Error("nope")));
      result.current.enqueue("k", async () => {
        ran = true;
      });
    });
    expect(ran).toBe(true);
    expect(result.current.pending("k")).toBe(false);
  });
});
