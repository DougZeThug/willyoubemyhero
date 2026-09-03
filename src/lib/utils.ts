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
const FONT_SIZE_TOKENS = [
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

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: FONT_SIZE_TOKENS }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
