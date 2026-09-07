// The shape of the bottom bar, as this device last saw it.
//
// Stored the way every other device preference in this app is — see the header of
// vault-favourites.ts: a `wwbh:` key, every touch of storage in a try/catch so a
// locked private-mode browser degrades to "works for this page load", a
// module-level `current` because that is all there is left to trust when a write
// is refused, and a custom event because `storage` only fires in *other* tabs.
//
// WHY A DEVICE STORE AND NOT A BETTER FETCH. The bar's rows come off the active
// event, and useActiveEvent is a plain query with no SSR hydration behind it, so
// the server render and the first client paint always draw the five-row default.
// A league with dust switched on then gains a sixth tab the moment the event
// lands and every tile narrows from a fifth of the bar to a sixth — the whole row
// slides sideways under a thumb already on its way down. Remembering the answer
// moves that correction from "after a round trip" to "on mount", which is before
// anybody has aimed at anything.
//
// The obvious alternative — dehydrating the query client so the server renders
// the real bar — is not available here: the e2e suite stubs server functions in
// the BROWSER, and a root loader would run in-process on the server, sail past
// the stubs and render every spec against a dead Supabase.
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { dustLive } from "@/lib/dust";
import { navHidden } from "@/lib/nav";

const KEY = "wwbh:nav-shape";
const CHANGED = "wwbh:nav-shape-changed";

/** The two answers that decide which rows the bar holds. */
export type NavShape = { dustOn: boolean; hidden: string[] };

/**
 * What the bar draws before it knows anything: every row the commissioner has
 * not switched off, and no Shop.
 *
 * Deliberately the same answer navTabs already gives for an undefined event, so
 * a device with nothing stored behaves exactly as it does today.
 */
export const DEFAULT_NAV_SHAPE: NavShape = { dustOn: false, hidden: [] };

let current: NavShape | null = null;

/** Parse, tolerating anything — junk under our key reads as "never stored". */
export function parseNavShape(raw: string | null): NavShape | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { dustOn, hidden } = value as { dustOn?: unknown; hidden?: unknown };
    if (typeof dustOn !== "boolean") return null;
    if (!Array.isArray(hidden)) return null;
    return { dustOn, hidden: hidden.filter((v): v is string => typeof v === "string") };
  } catch {
    return null;
  }
}

function read(): NavShape | null {
  if (typeof window === "undefined") return null;
  try {
    return parseNavShape(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function readNavShape(): NavShape | null {
  current = read();
  return current;
}

/** Whether two shapes would build the same bar. */
export function sameNavShape(a: NavShape | null, b: NavShape | null): boolean {
  if (!a || !b) return a === b;
  if (a.dustOn !== b.dustOn) return false;
  // Order is the commissioner's list order and means nothing to navTabs, which
  // reads the hidden set as a set. Sorting here stops a reordered column from
  // looking like a changed bar and rewriting storage on every load.
  const left = [...a.hidden].sort();
  const right = [...b.hidden].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/** Remember a shape the event has actually confirmed. */
export function writeNavShape(next: NavShape) {
  if (sameNavShape(current, next)) return;
  current = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode with storage blocked still holds the shape for this page load */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The shape carried by an event, or null while it has not answered. */
export function shapeOfEvent(event: unknown): NavShape | null {
  if (event === undefined) return null;
  return { dustOn: dustLive(event), hidden: navHidden(event) };
}

/**
 * A layout effect on the client and a plain one on the server, which React would
 * otherwise warn about during SSR.
 *
 * Load-bearing here rather than a preference: a passive effect runs AFTER the
 * browser has painted, so the bar would still show one frame of the five-row
 * default before correcting. A layout effect runs after the commit and before
 * the paint, so the remembered shape is the first thing drawn.
 */
const useNavShapeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The shape to build the bar from: the event's once it has answered, the
 * remembered one until then, and the five-row default on a device that has never
 * stored one.
 *
 * Storage is read in an effect and never during render, for the reason
 * use-photo-urls.ts is written around: SSR has no localStorage, so a render that
 * read it would hand the server one bar and the client another and hydrate into
 * a mismatch — which is a louder version of the bug this exists to fix.
 */
export function useNavShape(event: unknown): NavShape {
  const [remembered, setRemembered] = useState<NavShape | null>(null);

  useNavShapeEffect(() => {
    // Our own writes trust the module value; re-reading storage would hand a
    // private-mode browser back the value it just refused to save.
    const mine = () => setRemembered(current);
    // Another tab. That one did save, so storage is the truth.
    const theirs = () => {
      current = read();
      setRemembered(current);
    };
    theirs();
    window.addEventListener(CHANGED, mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(CHANGED, mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  // Memoised on the event, which react-query keeps referentially stable while
  // the data has not changed — so this effect runs when the answer changes and
  // not on every render of every screen the bar is mounted on.
  const answered = useMemo(() => shapeOfEvent(event), [event]);

  useEffect(() => {
    if (answered) writeNavShape(answered);
  }, [answered]);

  return answered ?? remembered ?? DEFAULT_NAV_SHAPE;
}
