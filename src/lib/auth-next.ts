// Where to send somebody once they are signed in, across a redirect that loses
// the query string.
//
// `/auth?next=/players/pack` works for the in-page sign-in: the page never
// unmounts, so `Route.useSearch()` still holds the destination when
// `signInWithPassword` resolves. The other two doors do not work that way.
// Google OAuth and an email confirmation link both LEAVE this origin and come
// back as a fresh load of `/auth` with nothing on the URL, so by the time the
// session exists the `next` that was asked for is gone — and "Sign in to claim"
// landed everybody on the vault instead of on the rung they were promised.
//
// Threading it through the return URL would work and was the first idea; it is
// not this one because both of those return URLs have to be on an allow-list
// somebody maintains in a dashboard, and a per-destination URL is a list that
// goes stale the first time a new CTA is added. The destination is this device's
// business, so it waits here instead.

const KEY = "wwbh:auth-next";

/**
 * How long a stashed destination is worth honouring.
 *
 * Long, because the slowest path through here is an email confirmation: the link
 * is clicked when somebody gets round to their inbox, not when they asked for
 * the account. Not unbounded, because this is the one thing that can redirect a
 * signed-in person off their own account screen — an abandoned round trip has to
 * stop meaning anything rather than lie in wait.
 */
const TTL_MS = 60 * 60 * 1000;

/**
 * Same-origin paths only.
 *
 * Shared with `/auth`'s own `validateSearch` so the rule is written once: a
 * value that came back off a redirect is no more trustworthy than one that
 * arrived on the URL, and a protocol-relative "//evil.com" is not a path.
 */
export function sanitizeNext(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : undefined;
}

/** Hold a destination across an auth redirect. No destination clears the last one. */
export function stashAuthNext(next: unknown) {
  if (typeof window === "undefined") return;
  const clean = sanitizeNext(next);
  if (!clean) {
    window.localStorage.removeItem(KEY);
    return;
  }
  window.localStorage.setItem(KEY, JSON.stringify({ next: clean, at: Date.now() }));
}

/**
 * Read the stashed destination and forget it.
 *
 * One shot, deliberately. A destination that survived being used would fire
 * again the next time somebody opened /auth from the header menu, bouncing them
 * off the account screen — which is the same complaint `wasSignedOut` exists to
 * answer, arriving by a different door.
 */
export function takeAuthNext(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return undefined;
  window.localStorage.removeItem(KEY);
  try {
    const parsed = JSON.parse(raw) as { next?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > TTL_MS) return undefined;
    return sanitizeNext(parsed.next);
  } catch {
    // A hand-edited or half-written value is simply not a destination. It has
    // already been removed above, so this cannot repeat.
    return undefined;
  }
}
