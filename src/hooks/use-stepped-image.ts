import { useState } from "react";
import { srcSetFromSet, urlFromSet } from "@/lib/media";

/**
 * Sizes to try, widest first. A stalled fetch used to leave a broken-image icon
 * and then, briefly, a permanent "no card art" placeholder — so instead of
 * giving up on the first error, drop to the next smaller (cheaper) rendition
 * and only show the placeholder once every size has failed.
 */
const SIZE_STEPS = ["large", "medium", "thumb"] as const;

export function useSteppedImage(set: Parameters<typeof urlFromSet>[0], eager: boolean) {
  const start = eager ? 0 : 1;
  const [step, setStep] = useState(start);
  const key =
    typeof set === "string"
      ? set
      : [set?.large ?? "", set?.medium ?? "", set?.thumb ?? ""].join("|");
  // Any re-signed or replaced rendition is a fresh chance, not only `large`.
  // Reset during render, so a new rendition never paints at the old step.
  const [stepFor, setStepFor] = useState(`${key}#${start}`);
  if (stepFor !== `${key}#${start}`) {
    setStepFor(`${key}#${start}`);
    setStep(start);
  }

  const failed = step >= SIZE_STEPS.length;
  const size = SIZE_STEPS[Math.min(step, SIZE_STEPS.length - 1)];
  return {
    failed,
    src: failed ? null : urlFromSet(set, size),
    // Once the browser rejects its selected srcset candidate, retry one exact
    // URL at a time. Keeping srcset here can make it select the same bad file
    // again even though `src` stepped down.
    srcSet: failed || step > start ? undefined : srcSetFromSet(set, size),
    onError: () => setStep((s) => s + 1),
  };
}
