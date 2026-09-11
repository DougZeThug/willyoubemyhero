import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The type scale from src/styles.css (§16 of the mobile UX audit).
 *
 * tailwind-merge cannot read the CSS theme, so out of the box it files an
 * unrecognised `text-*` under text-COLOUR — and then drops `text-label` the
 * moment a real colour class appears anywhere in the same cn() call. The
 * element silently keeps its inherited size, which is exactly the bug the
 * scale exists to fix and shows up in no test that does not read the DOM.
 *
 * Every font-size token added to @theme belongs here too.
 */
export const FONT_SIZE_TOKENS = [
  "title",
  "section",
  "card-name",
  "viewer-name",
  "body",
  "label",
  "meta",
  "badge",
  "nav",
  "button",
];

/**
 * The spacing scale, for the same reason and a worse failure.
 *
 * `text-page-x` would at least be filed as a colour; `px-page-x` matches no
 * pattern at all, so tailwind-merge passes it through untouched — `px-page-x`
 * beside `px-6` keeps BOTH. And a named theme value sorts after every numeric
 * one in the compiled sheet, so the one that wins is the token, whichever the
 * caller wrote last. The override points backwards and no test can see it.
 *
 * Only the tokens actually spelled as a class belong here, which is why this is
 * three entries and not five: --spacing-stack-gap and --spacing-control-gap were
 * the same 0.5rem under two names and neither was ever written down.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZE_TOKENS }],
      px: [{ px: ["page-x"] }],
      gap: [{ gap: ["grid-gap"] }],
      "space-y": [{ "space-y": ["section-gap"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
