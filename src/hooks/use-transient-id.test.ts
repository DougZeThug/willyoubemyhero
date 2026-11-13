import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTransientId } from "./use-transient-id";

describe("useTransientId", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds an id for the given time, then clears it", () => {
    const { result } = renderHook(() => useTransientId(1000));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("a"));
    expect(result.current[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBeNull();
  });

  it("restarts the clock when a new id arrives", () => {
    const { result } = renderHook(() => useTransientId(1000));
    act(() => result.current[1]("a"));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => result.current[1]("b"));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current[0]).toBe("b");
  });
});
