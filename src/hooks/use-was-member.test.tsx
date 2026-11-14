import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWasMember } from "./use-was-member";
import { WAS_MEMBER_KEY } from "@/lib/member-token";

describe("useWasMember", () => {
  afterEach(() => localStorage.removeItem(WAS_MEMBER_KEY));

  it("is false on a phone that never claimed", () => {
    expect(renderHook(() => useWasMember()).result.current).toBe(false);
  });

  it("is true once the claim breadcrumb is on the phone", () => {
    localStorage.setItem(WAS_MEMBER_KEY, "1");
    expect(renderHook(() => useWasMember()).result.current).toBe(true);
  });
});
