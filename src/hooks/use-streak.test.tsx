import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";

const serverFnMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => serverFnMock,
}));

import { streakStatusKey, useStreakStatus } from "./use-streak";

describe("streakStatusKey", () => {
  it("is keyed on the actor, never on the event", () => {
    // A streak is a permanent record of showing up. An event id in the key would
    // throw it away every year — the same reason secretStatusKey omits one.
    expect(streakStatusKey("m:abc")).toEqual(["pack-streak", "m:abc"]);
    expect(streakStatusKey("g:abc")).not.toEqual(streakStatusKey("m:abc"));
  });

  it("gives a device that has not hydrated its own key, not somebody else's", () => {
    expect(streakStatusKey(null)).toEqual(["pack-streak", null]);
    expect(streakStatusKey(null)).not.toEqual(streakStatusKey("m:abc"));
  });
});

describe("useStreakStatus", () => {
  it("does not ask before an identity has hydrated", async () => {
    serverFnMock.mockReset();
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useStreakStatus(null), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(serverFnMock).not.toHaveBeenCalled();
  });

  it("fetches once an actor is there", async () => {
    serverFnMock.mockReset();
    serverFnMock.mockResolvedValue({ current: 3, kind: "member" });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useStreakStatus("m:abc"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.current).toBe(3);
  });

  it("surfaces an expired token instead of retrying behind a spinner", async () => {
    serverFnMock.mockReset();
    serverFnMock.mockRejectedValue(new Error("Claim your player first"));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useStreakStatus("m:abc"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(serverFnMock).toHaveBeenCalledTimes(1);
  });
});
