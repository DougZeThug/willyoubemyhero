export const CARD_SERIES = {
  draft_combine_player: {
    label: "Draft Combine Player",
    player: true,
    prompt: `Create a premium vertical Draft Combine player trading card. Build the composition around this specific athlete: invent subject-specific action, scenery, equipment, background jokes, and visual storytelling from the information supplied below rather than forcing every athlete into one shared layout. Preserve a polished collectible sports-card finish with confident typography and clear information hierarchy. Include 4–6 personalized, humorous stats or callouts inspired only by the supplied facts; playful invention is welcome, but do not invent official performance results. Make the athlete recognizable from the attached reference photograph.`,
  },
  cornhole_player: {
    label: "Cornhole Player",
    player: true,
    prompt: `Create a premium vertical cornhole player trading card starring this specific person. Design an original subject-led composition with individualized scenery, pose, bags, boards, props, jokes, and background details—never a rigid shared template. Use the supplied event data as creative fuel and show 4–6 personalized humorous stats or callouts, while never fabricating official results. Keep the finish unmistakably collectible, energetic, and print-ready, and make the player recognizable from the attached reference photograph.`,
  },
  secret_pet: {
    label: "Secret Pet",
    player: false,
    prompt: `Create a delightfully rare vertical Secret Pet collectible card. Let this particular pet's personality determine the composition, scenery, pose, toys, treats, props, sight gags, and small background jokes rather than using a rigid shared layout. Give it premium secret-card drama and include 4–6 personalized humorous stats or callouts grounded in the supplied description. Make the subject recognizable from any attached reference photograph.`,
  },
  legacy_pet: {
    label: "Legacy Pet",
    player: false,
    prompt: `Create a warm, celebratory vertical Legacy Pet collectible card. Treat the specific animal with affection and dignity while allowing personality-driven scenery, meaningful props, gentle jokes, and a unique composition instead of a rigid shared layout. Include 4–6 personalized humorous or heartfelt stats/callouts based on the supplied memories. Use any attached photograph to preserve the pet's recognizable appearance, and finish it like a treasured premium keepsake card.`,
  },
  wag_secret_rare: {
    label: "WAG Secret Rare",
    player: false,
    prompt: `Create a glamorous, funny vertical WAG Secret Rare collectible card for this specific subject. Build a bespoke composition around their personality and association, with individualized scenery, fashion, props, inside jokes, and background Easter eggs—not a rigid shared layout. Add 4–6 personalized humorous stats or callouts based on the supplied information. Aim for extravagant secret-rare polish and make the subject recognizable from any attached reference photograph.`,
  },
  custom_secret: {
    label: "Custom Secret",
    player: false,
    prompt: `Create a one-of-one vertical Custom Secret collectible card for this particular subject. Allow the supplied story to dictate a unique composition, scenery, pose, props, jokes, and Easter eggs rather than imposing a rigid shared layout. Include 4–6 personalized humorous stats or callouts grounded in the supplied details. Deliver premium collectible-card typography, hierarchy, and finish, using any attached reference photograph to keep the subject recognizable.`,
  },
} as const;

export type CardSeriesId = keyof typeof CARD_SERIES;

export const CARD_SERIES_OPTIONS = Object.entries(CARD_SERIES).map(([id, value]) => ({
  id: id as CardSeriesId,
  ...value,
}));

export function isPlayerSeries(series: CardSeriesId): boolean {
  return CARD_SERIES[series].player;
}

export type CardPromptInput = {
  series: CardSeriesId;
  eventName?: string;
  subjectName: string;
  nickname?: string;
  association?: string;
  knownData?: string;
  colors?: string;
  about?: string;
  visualMustHaves?: string;
  referencePhotoUrl?: string;
};

function section(title: string, lines: Array<string | undefined>): string | null {
  const content = lines.map((line) => line?.trim()).filter(Boolean);
  return content.length ? `--- ${title} ---\n${content.join("\n")}` : null;
}

/** Pure prompt assembly, intentionally independent from React and clipboard APIs. */
export function buildCardPrompt(input: CardPromptInput): string {
  const parts = [
    CARD_SERIES[input.series].prompt,
    section("SUBJECT INFORMATION", [
      `Series: ${CARD_SERIES[input.series].label}`,
      `Subject name: ${input.subjectName.trim()}`,
      input.nickname?.trim() ? `Nickname: ${input.nickname.trim()}` : undefined,
      input.association?.trim() ? `Owner / association: ${input.association.trim()}` : undefined,
    ]),
    section("KNOWN EVENT / PERFORMANCE DATA", [
      input.eventName?.trim() ? `Event: ${input.eventName.trim()}` : undefined,
      input.knownData,
    ]),
    section("CARD-SPECIFIC VISUAL NOTES", [
      input.colors?.trim() ? `Preferred colors: ${input.colors.trim()}` : undefined,
      input.visualMustHaves?.trim()
        ? `Visual must-haves: ${input.visualMustHaves.trim()}`
        : undefined,
    ]),
    section("CREATIVE DIRECTION", [
      input.about?.trim() ? `Tell me about this card: ${input.about.trim()}` : undefined,
    ]),
    section("REFERENCE PHOTOS", [
      input.referencePhotoUrl?.trim()
        ? `A participant photograph is available at ${input.referencePhotoUrl.trim()}. The administrator will attach it manually in ChatGPT; use the attachment as the visual reference.`
        : "No reference photograph URL is currently available. Ask for an attachment if likeness is important.",
    ]),
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function buildRevisionPrompt(input: {
  series: CardSeriesId;
  subjectName: string;
  changes: string;
}): string {
  return `Revise the existing ${CARD_SERIES[input.series].label} card for ${input.subjectName.trim()}. Preserve the existing layout, styling, typography, palette, primary illustration, stat panel, and premium collectible-card appearance. Do not redesign or alter anything not explicitly requested below.\n\n--- CHANGE ONLY THE FOLLOWING ---\n${input.changes.trim()}`;
}
