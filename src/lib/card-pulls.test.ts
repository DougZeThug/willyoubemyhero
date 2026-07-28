import { describe, expect, it } from "vitest";
import { packedByLabel } from "./card-pulls";

describe("packedByLabel", () => {
  it("says nothing about a card nobody has packed", () => {
    // The vault is full of cards nobody has got to yet. "Packed by 0" would read
    // as a score rather than an absence.
    expect(packedByLabel(0)).toBeNull();
    expect(packedByLabel(undefined)).toBeNull();
  });

  it.each([
    [1, "Packed by 1"],
    [7, "Packed by 7"],
    [13, "Packed by 13"],
  ])("reads %i as %s", (n, expected) => {
    expect(packedByLabel(n)).toBe(expected);
  });

  it("never carries a denominator", () => {
    // A denominator over the roster would be a promise the numerator cannot keep
    // — only claimed members are counted — and one over claimed members quietly
    // announces how many of the group have signed in. It also keeps this app free
    // of any total anywhere, which is what protects the secret set's size.
    expect(packedByLabel(7)).not.toMatch(/\bof\b|\//);
  });
});
