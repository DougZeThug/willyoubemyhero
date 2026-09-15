// The destination that has to survive leaving the origin.
//
// Everything here is one-shot and sanitised on BOTH ends, and both of those are
// invisible when they work: a stash that is not consumed redirects somebody off
// their own account screen a week later, and one that trusts what it reads back
// turns a same-origin-only rule into an open redirect the moment localStorage is
// the input rather than the URL.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeNext, stashAuthNext, takeAuthNext } from "./auth-next";

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("sanitizeNext", () => {
  it("takes a same-origin path", () => {
    expect(sanitizeNext("/players/pack")).toBe("/players/pack");
    expect(sanitizeNext("/")).toBe("/");
  });

  it("refuses anything that could leave the origin", () => {
    // The one that matters: a protocol-relative URL is not a path, and the
    // browser reads it as a host.
    expect(sanitizeNext("//evil.com")).toBeUndefined();
    expect(sanitizeNext("https://evil.com")).toBeUndefined();
    expect(sanitizeNext("players/pack")).toBeUndefined();
  });

  it("refuses anything that is not a string", () => {
    expect(sanitizeNext(undefined)).toBeUndefined();
    expect(sanitizeNext(null)).toBeUndefined();
    expect(sanitizeNext(7)).toBeUndefined();
    expect(sanitizeNext(["/players"])).toBeUndefined();
  });
});

describe("the auth-next stash", () => {
  it("hands back what a round trip left behind", () => {
    stashAuthNext("/players/pack");
    expect(takeAuthNext()).toBe("/players/pack");
  });

  it("gives it back exactly once", () => {
    // Otherwise opening /auth from the header menu later bounces a signed-in
    // person straight off their own account screen — the same complaint the
    // `wasSignedOut` guard on that page exists to answer.
    stashAuthNext("/players/pack");
    expect(takeAuthNext()).toBe("/players/pack");
    expect(takeAuthNext()).toBeUndefined();
  });

  it("answers nothing when nothing was stashed", () => {
    expect(takeAuthNext()).toBeUndefined();
  });

  it("clears the last destination rather than keeping it", () => {
    // `stashAuthNext(goTo)` is called on every round trip, including the ones
    // with no destination. Leaving the previous one standing would send somebody
    // who just wanted an account to wherever the last person was headed.
    stashAuthNext("/players/pack");
    stashAuthNext(undefined);
    expect(takeAuthNext()).toBeUndefined();
  });

  it("never stashes something it would refuse to hand back", () => {
    stashAuthNext("https://evil.com");
    expect(takeAuthNext()).toBeUndefined();
  });

  it("refuses a destination somebody wrote into storage by hand", () => {
    // The value comes back off the device rather than off the URL, so the
    // same-origin rule has to hold on the way out as well as on the way in.
    window.localStorage.setItem(
      "wwbh:auth-next",
      JSON.stringify({ next: "//evil.com", at: Date.now() }),
    );
    expect(takeAuthNext()).toBeUndefined();
  });

  it("forgets a stale destination instead of firing it", () => {
    vi.useFakeTimers();
    stashAuthNext("/players/pack");
    // An hour is the budget — long enough for an email confirmation, short
    // enough that an abandoned round trip stops meaning anything.
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(takeAuthNext()).toBeUndefined();
  });

  it("still honours one that is merely slow", () => {
    vi.useFakeTimers();
    stashAuthNext("/players/pack");
    // Somebody getting round to their inbox. This is the commonest sign-up path
    // in the league and it must not be the one that breaks.
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(takeAuthNext()).toBe("/players/pack");
  });

  it("survives a half-written value without throwing", () => {
    window.localStorage.setItem("wwbh:auth-next", "{not json");
    expect(takeAuthNext()).toBeUndefined();
    // And does not keep failing on it.
    expect(window.localStorage.getItem("wwbh:auth-next")).toBeNull();
  });
});
