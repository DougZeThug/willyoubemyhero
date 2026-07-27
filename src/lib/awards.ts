// Superlative categories the league votes on. Shared by the voting page, the
// admin console, and the award badges on card backs.
//
// `id` is stored in award_votes.category and awards.award_type, so renaming an
// id orphans existing votes — add a new category instead.

export type AwardCategory = {
  id: string;
  label: string;
  blurb: string;
  /** Emoji used for the badge on a card back. */
  icon: string;
};

export const AWARD_CATEGORIES: readonly AwardCategory[] = [
  {
    id: "mvp",
    label: "MVP",
    blurb: "Carried the whole combine on their back.",
    icon: "🏆",
  },
  {
    id: "best_card",
    label: "Best Card Art",
    blurb: "The card you'd actually put in a sleeve.",
    icon: "🎨",
  },
  {
    id: "trash_talker",
    label: "Biggest Trash Talker",
    blurb: "All mouth, results pending.",
    icon: "🗣️",
  },
  {
    id: "most_likely_to_puke",
    label: "Most Likely to Puke",
    blurb: "We all know. Vote honestly.",
    icon: "🤢",
  },
  {
    id: "weakest_link",
    label: "Weakest Link",
    blurb: "Someone has to go last in the draft.",
    icon: "🪫",
  },
  {
    id: "clutch",
    label: "Most Clutch",
    blurb: "Shows up when the beer is on the line.",
    icon: "🧊",
  },
] as const;

const IDS = new Set(AWARD_CATEGORIES.map((c) => c.id));

export function isAwardCategory(id: string): boolean {
  return IDS.has(id);
}

export function awardCategory(id: string): AwardCategory | undefined {
  return AWARD_CATEGORIES.find((c) => c.id === id);
}
