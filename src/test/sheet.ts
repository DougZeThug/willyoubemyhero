import { act } from "@testing-library/react";

/**
 * Finish the exit animation of every closed vaul sheet on screen.
 *
 * jsdom 31 applies the stylesheet vaul injects, so a closed sheet now computes
 * `animation-name: slideToBottom` and Radix's Presence waits for the
 * `animationend` that follows it before unmounting the sheet and lifting the
 * `aria-hidden` it put on the rest of the page. jsdom plays no animations, so
 * that event never comes. On jsdom 30 the same sheet computed `none` and
 * unmounted at once. A browser fires the event itself; this stands in for it.
 */
export function finishSheetExit(): void {
  const closing = document.querySelectorAll<HTMLElement>(
    "[data-vaul-drawer][data-state='closed'], [data-vaul-overlay][data-state='closed']",
  );
  act(() => {
    for (const el of closing) {
      const event = new Event("animationend", { bubbles: true });
      Object.defineProperty(event, "animationName", {
        value: getComputedStyle(el).animationName,
      });
      el.dispatchEvent(event);
    }
  });
}
