import { describe, expect, it } from "vitest";
import { collectionSettled, dustHolder, idOf } from "./collection-view";

describe("collection view rules", () => {
  it("reads an event id off a missing event as null", () => {
    expect(idOf(undefined)).toBeNull();
    expect(idOf({ id: "e1" })).toBe("e1");
  });

  it("asks about a dust balance for members only, and only when dust is on", () => {
    expect(dustHolder(true, { participantId: "p1" })).toBe("p1");
    expect(dustHolder(true, null)).toBeFalsy();
    expect(dustHolder(false, { participantId: "p1" })).toBeNull();
  });

  it("holds the collection back while an account is linking", () => {
    expect(collectionSettled(true, { status: "idle" })).toBe(true);
    expect(collectionSettled(true, { status: "syncing" })).toBe(false);
    expect(collectionSettled(false, { status: "idle" })).toBe(false);
  });
});
