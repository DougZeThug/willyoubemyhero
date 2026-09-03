// Warm the dev server before the workers arrive.
//
// Vite optimises a dependency the first time something asks for it, and a
// re-bundle mid-flight invalidates module URLs that are already in the air. The
// browser reports that as "Failed to fetch dynamically imported module" and the
// test fails on a page that never finished hydrating. Two workers opening a cold
// server at once are both inside exactly that window; one request that finishes
// first closes it.
//
// This runs after `webServer` is up — Playwright sets its plugins up before
// global setup — so the server is already listening here. Two passes over the
// two heaviest entry points: the first sets the optimiser going, the second
// waits for it to have settled.
import type { FullConfig } from "@playwright/test";

const ENTRY_POINTS = ["/", "/players"];

export default async function warmUp(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("e2e warm-up: no baseURL on the first project, nothing to warm.");

  for (let pass = 0; pass < 2; pass++) {
    for (const path of ENTRY_POINTS) {
      const response = await fetch(new URL(path, baseURL));
      // Drained rather than dropped: an SSR render nobody reads can be cut
      // short, and a render cut short has not warmed anything.
      await response.text();
    }
  }
}
