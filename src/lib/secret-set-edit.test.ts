import { describe, expect, it } from "vitest";
import { setEditRefusal } from "./secret-set-edit";

// A refused set edit resolves rather than throws, so it arrives down the success
// arm of the panel's toast with only a reason code to explain itself from. Two
// of those codes used to land on the name line — which a delete never sends —
// and sent the commissioner hunting for a typo instead of the Hide button one
// icon along the same row.
describe("setEditRefusal", () => {
  it("points a set that still has cards at Hide", () => {
    expect(setEditRefusal("in_use")).toBe("That set still has cards in it — hide it instead");
  });

  it("points a set somebody has finished at Hide too", () => {
    // deleteSecretCollection refuses an EMPTY set that already has trophies
    // against it. Nothing about the name is wrong, and nothing the commissioner
    // types will make the delete work — hiding is the whole answer.
    expect(setEditRefusal("has_trophies")).toBe(
      "Somebody has already finished that set — hide it instead",
    );
  });

  it("says so when the set is already gone", () => {
    // updateSecretCollection's miss: another tab, or another phone in the
    // garden, deleted it between the list load and the rename.
    expect(setEditRefusal("not_found")).toBe("That set is already gone — pull to refresh");
  });

  it("names the clash for a duplicate set name", () => {
    expect(setEditRefusal("exists")).toBe("There's already a set with that name");
  });

  it("keeps the name line for the name a create actually refused", () => {
    expect(setEditRefusal("bad_name")).toBe("That name doesn't work — try letters and numbers");
  });

  it("falls back to the name line for a reason it has never seen", () => {
    // The likelier next reason is another validation, not another conflict.
    expect(setEditRefusal("something_new")).toBe(
      "That name doesn't work — try letters and numbers",
    );
    expect(setEditRefusal(undefined)).toBe("That name doesn't work — try letters and numbers");
  });
});
