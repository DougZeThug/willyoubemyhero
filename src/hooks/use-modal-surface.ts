import { useCallback, useEffect, useRef } from "react";

/**
 * Focus handling for the three full-screen reveals.
 *
 * `role="dialog"` and `aria-modal` describe an overlay; they do not confine
 * anything. Each reveal had grown its own focus-on-mount effect and none of them
 * trapped Tab, so a keyboard or switch user tabbed straight out of the ceremony
 * into the nav behind it — which is still painted, just covered — and after
 * dismissing landed back at the top of the document rather than on the button
 * they pressed.
 *
 * Deliberately not `inert` on the page root: the reveals mount inside the tree
 * they would have to inert, and PresentationMode already handles the chrome. A
 * cycle within the surface is the part the browser will not do for us.
 *
 * @param active Whether the surface is on screen. False leaves focus alone.
 * @returns The ref to put on the surface element, which must be focusable
 *   (`tabIndex={-1}` on a div, or a button).
 */
export function useModalSurface<T extends HTMLElement>(active = true) {
  const surfaceRef = useRef<T>(null);
  // Captured before the surface takes focus, so "the opener" is whatever the
  // person was actually on rather than whatever happens to be focused at close.
  const openerRef = useRef<Element | null>(null);

  const restore = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    // Still in the document: an opener the reveal itself replaced — a pack that
    // has been opened, a shop row that has sold — cannot be focused back.
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, []);

  useEffect(() => {
    if (!active) return;
    openerRef.current = document.activeElement;
    surfaceRef.current?.focus();
    return restore;
  }, [active, restore]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const surface = surfaceRef.current;
      if (!surface) return;
      // No visibility filter: jsdom reports every element as unlaid-out, and the
      // reveals hide nothing behind `hidden` — the surface's own controls are all
      // there is inside it.
      const focusable = [
        ...surface.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute("hidden"));
      // Nothing to cycle between — hold focus on the surface rather than letting
      // it escape to the nav underneath.
      if (focusable.length === 0) {
        e.preventDefault();
        surface.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === surface)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (!surface.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  return surfaceRef;
}
