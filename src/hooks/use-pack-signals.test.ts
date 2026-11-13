import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PACK_STATE_CHANGED } from "@/lib/card-collection";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { usePackSignals } from "./use-pack-signals";

const storage = (key: string | null) => window.dispatchEvent(new StorageEvent("storage", { key }));

describe("usePackSignals", () => {
  it("routes each signal to its own handler", () => {
    const changedHere = vi.fn();
    const dealtElsewhere = vi.fn();
    const unrecordedElsewhere = vi.fn();
    renderHook(() => usePackSignals({ changedHere, dealtElsewhere, unrecordedElsewhere }));

    act(() => void window.dispatchEvent(new Event(PACK_STATE_CHANGED)));
    expect(
      [changedHere, dealtElsewhere, unrecordedElsewhere].map((f) => f.mock.calls.length),
    ).toEqual([1, 0, 0]);

    act(() => storage(STORAGE_KEYS.packDealt));
    expect(
      [changedHere, dealtElsewhere, unrecordedElsewhere].map((f) => f.mock.calls.length),
    ).toEqual([1, 1, 0]);

    act(() => storage(STORAGE_KEYS.packUnrecorded));
    expect(
      [changedHere, dealtElsewhere, unrecordedElsewhere].map((f) => f.mock.calls.length),
    ).toEqual([1, 1, 1]);
  });

  it("ignores another tab's unrelated keys", () => {
    const dealtElsewhere = vi.fn();
    renderHook(() => usePackSignals({ dealtElsewhere }));
    act(() => storage("wwbh:something-else"));
    expect(dealtElsewhere).not.toHaveBeenCalled();
  });

  it("treats localStorage.clear() as a change to both rows", () => {
    const dealtElsewhere = vi.fn();
    const unrecordedElsewhere = vi.fn();
    renderHook(() => usePackSignals({ dealtElsewhere, unrecordedElsewhere }));
    act(() => storage(null));
    expect(dealtElsewhere).toHaveBeenCalledTimes(1);
    expect(unrecordedElsewhere).toHaveBeenCalledTimes(1);
  });

  it("calls the handler from the latest render without resubscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => usePackSignals({ changedHere: fn }), {
      initialProps: { fn: first },
    });
    rerender({ fn: second });
    act(() => void window.dispatchEvent(new Event(PACK_STATE_CHANGED)));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
