import { describe, expect, it } from "vitest";
import { AWARD_CATEGORIES, awardCategory, isAwardCategory } from "./awards";

describe("AWARD_CATEGORIES", () => {
  // These ids are stored in award_votes.category and awards.award_type.
  // Renaming one orphans every vote already cast for it, which is why the
  // module header says to add a new category instead. This is that guardrail:
  // if you are here because this test failed, add an id, don't rename one.
  it("has a frozen set of ids", () => {
    expect(AWARD_CATEGORIES.map((c) => c.id)).toEqual([
      "mvp",
      "best_card",
      "trash_talker",
      "most_likely_to_puke",
      "weakest_link",
      "clutch",
    ]);
  });

  it("has no duplicate ids", () => {
    const ids = AWARD_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every category a label, blurb and badge icon", () => {
    for (const category of AWARD_CATEGORIES) {
      expect(category.label).toBeTruthy();
      expect(category.blurb).toBeTruthy();
      expect(category.icon).toBeTruthy();
    }
  });

  it("keeps ids within the 40 characters castAwardVote accepts", () => {
    for (const category of AWARD_CATEGORIES) {
      expect(category.id.length).toBeLessThanOrEqual(40);
      expect(category.id).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("isAwardCategory", () => {
  it("accepts every known id", () => {
    for (const category of AWARD_CATEGORIES) {
      expect(isAwardCategory(category.id)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isAwardCategory("")).toBe(false);
    expect(isAwardCategory("MVP")).toBe(false);
    expect(isAwardCategory("most_valuable")).toBe(false);
    // Set membership, not property lookup — a prototype key is not a category.
    expect(isAwardCategory("toString")).toBe(false);
    expect(isAwardCategory("constructor")).toBe(false);
  });
});

describe("awardCategory", () => {
  it("returns the matching category", () => {
    expect(awardCategory("mvp")).toMatchObject({ id: "mvp", label: "MVP" });
  });

  it("returns undefined for an unknown id", () => {
    expect(awardCategory("nope")).toBeUndefined();
  });
});
