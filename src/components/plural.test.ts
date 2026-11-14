import { expect, it } from "vitest";
import { plural } from "./plural";

it("is singular at exactly one, plural otherwise including zero", () => {
  expect(plural(1, "station")).toBe("1 station");
  expect(plural(0, "station")).toBe("0 stations");
  expect(plural(2, "station")).toBe("2 stations");
});
