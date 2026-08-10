import { describe, expect, it } from "vitest";
import { CARD_SERIES_OPTIONS, buildCardPrompt, buildRevisionPrompt } from "./card-prompt-templates";

describe("card prompt templates", () => {
  it("offers every initial series", () => {
    expect(CARD_SERIES_OPTIONS.map((option) => option.label)).toEqual([
      "Draft Combine Player",
      "Cornhole Player",
      "Secret Pet",
      "Legacy Pet",
      "WAG Secret Rare",
      "Custom Secret",
    ]);
  });

  it("assembles a non-player subject without participant data and omits blanks", () => {
    const prompt = buildCardPrompt({
      series: "secret_pet",
      subjectName: "Pickles",
      association: "Maya's dog",
      about: "Steals socks",
      colors: "   ",
      visualMustHaves: "",
    });
    expect(prompt).toContain("Subject name: Pickles");
    expect(prompt).toContain("Owner / association: Maya's dog");
    expect(prompt).toContain("Tell me about this card: Steals socks");
    expect(prompt).not.toContain("Preferred colors:");
    expect(prompt).not.toContain("Nickname:");
  });

  it("produces deterministic, tightly scoped revision instructions", () => {
    const input = {
      series: "custom_secret" as const,
      subjectName: "The Grill",
      changes: "Make the smoke blue.",
    };
    expect(buildRevisionPrompt(input)).toBe(buildRevisionPrompt(input));
    expect(buildRevisionPrompt(input)).toContain("CHANGE ONLY THE FOLLOWING");
    expect(buildRevisionPrompt(input)).toContain(
      "Preserve the existing layout, styling, typography, palette, primary illustration, stat panel",
    );
  });
});
