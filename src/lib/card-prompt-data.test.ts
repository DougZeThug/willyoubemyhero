import { describe, expect, it } from "vitest";
import {
  buildBatchPrompts,
  restoredEventParticipantId,
  standaloneBatchRowsValid,
} from "./card-prompt-data";

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

  it("requires an association for every populated standalone batch row", () => {
    expect(standaloneBatchRowsValid([{ name: "Pickles", association: "" }])).toBe(false);
    expect(standaloneBatchRowsValid([{ name: "Pickles", association: "Maya" }])).toBe(true);
  });

  it("falls back to the history row participant id for older batch snapshots", () => {
    expect(restoredEventParticipantId({ series: "draft_combine_player" }, "event-player-1")).toBe(
      "event-player-1",
    );
    expect(
      restoredEventParticipantId({ eventParticipantId: "snapshot-player" }, "row-player"),
    ).toBe("snapshot-player");
  });
});
