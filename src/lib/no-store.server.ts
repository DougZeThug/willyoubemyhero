import { setResponseHeader } from "@tanstack/react-start/server";

/**
 * Mark this response private and uncacheable. Member-scoped responses vary only
 * by a request header, so a cache hit would be somebody else's pack, balance or
 * spoiler. Latent today — Cloudflare does not cache Worker responses by default
 * — but stated, so it stays true if that changes.
 */
export function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}
