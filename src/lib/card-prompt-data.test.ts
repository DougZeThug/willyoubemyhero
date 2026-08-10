import { describe, expect, it } from "vitest";
import { buildBatchPrompts } from "./card-prompt-data";

describe("buildBatchPrompts", () => {
  it("keeps standalone subjects and their notes isolated", () => {
    const rows = buildBatchPrompts([
      {
        key: "one",
        input: { series: "secret_pet", subjectName: "Pickles", about: "Steals socks" },
      },
      {
        key: "two",
        input: { series: "secret_pet", subjectName: "Moose", about: "Loves sprinklers" },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].prompt).toContain("Steals socks");
    expect(rows[0].prompt).not.toContain("sprinklers");
    expect(rows[1].prompt).toContain("Loves sprinklers");
  });

  it("omits unnamed standalone rows", () => {
    expect(
      buildBatchPrompts([{ key: "blank", input: { series: "custom_secret", subjectName: " " } }]),
    ).toEqual([]);
  });
});
