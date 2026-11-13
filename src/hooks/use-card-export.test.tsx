import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const exportCardPng = vi.fn();
const waitForPaint = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/share-card", () => ({
  exportCardPng: (...a: unknown[]) => exportCardPng(...a),
  waitForPaint: (...a: unknown[]) => waitForPaint(...a),
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { useCardExport } from "./use-card-export";

beforeEach(() => {
  vi.clearAllMocks();
  exportCardPng.mockResolvedValue(undefined);
  waitForPaint.mockResolvedValue(undefined);
});

describe("useCardExport", () => {
  it("says the card was not ready when nothing mounted behind the ref", async () => {
    const { result } = renderHook(() => useCardExport());
    await act(() => result.current.exportCard("x.png", { fallback: "nope" }));
    expect(toastError).toHaveBeenCalledWith("Share card not ready");
    expect(exportCardPng).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("prepares, waits for paint, then exports the node", async () => {
    const { result } = renderHook(() => useCardExport());
    const node = document.createElement("div");
    (result.current.ref as { current: HTMLDivElement | null }).current = node;
    const prepare = vi.fn().mockResolvedValue(undefined);
    await act(() => result.current.exportCard("x.png", { fallback: "nope", prepare }));
    expect(prepare).toHaveBeenCalled();
    expect(waitForPaint).toHaveBeenCalledWith(node);
    expect(exportCardPng).toHaveBeenCalledWith(node, "x.png");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("falls back to its own sentence for a non-Error failure", async () => {
    const { result } = renderHook(() => useCardExport());
    (result.current.ref as { current: HTMLDivElement | null }).current =
      document.createElement("div");
    exportCardPng.mockRejectedValue("boom");
    await act(() => result.current.exportCard("x.png", { fallback: "Could not export card" }));
    expect(toastError).toHaveBeenCalledWith("Could not export card");
  });
});
