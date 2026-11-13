import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("reads an Error's message", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads the message off a plain object that is not an Error", () => {
    expect(errorMessage({ message: "boom" }, "fallback")).toBe("boom");
  });

  it("falls back for anything else that was thrown", () => {
    expect(errorMessage("boom", "fallback")).toBe("fallback");
    expect(errorMessage({ message: 42 }, "fallback")).toBe("fallback");
    expect(errorMessage(null, "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
  });
});
