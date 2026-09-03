// Warm the dev server before the workers arrive.
//
// Vite optimises a dependency the first time something asks for it, and a
// re-bundle mid-flight invalidates module URLs that are already in the air. The
// browser reports that as "Failed to fetch dynamically imported module" and the
// test fails on a page that never finished hydrating. Two workers opening a cold
// server at once are both inside exactly that window; one page that gets there
// first closes it.
//
// A browser rather than a `fetch`, because a fetch of `/` only retrieves the
// SSR'd HTML: it never executes the module scripts, so the client route chunks —
// the ones the optimiser has not seen and would re-bundle under a worker — are
// never requested at all. Warming the half of the graph that was not racing
// would have been worse than nothing here, since this commit also makes the job
// blocking.
//
// This runs after `webServer` is up, because Playwright sets its plugins up
// before global setup.
import { chromium, type FullConfig } from "@playwright/test";

const ENTRY_POINTS = ["/", "/players"];

export default async function warmUp(config: FullConfig) {
  const use = config.projects[0]?.use;
  if (!use?.baseURL)
    throw new Error("e2e warm-up: no baseURL on the first project, nothing to warm.");

  // The project's own launch options, so a sandbox pointing PLAYWRIGHT_CHROMIUM_PATH
  // at its Chromium warms with the same binary the tests will run.
  const browser = await chromium.launch(use.launchOptions);
  try {
    const page = await browser.newPage({ baseURL: use.baseURL });
    // Twice over: the first pass sets the optimiser going — and a re-bundle
    // reloads the page out from under it — and the second proves it has settled.
    for (let pass = 0; pass < 2; pass++) {
      for (const path of ENTRY_POINTS) {
        await page.goto(path);
        // The route chunks land after hydration, which is the part a plain
        // document load does not wait for. Bounded and swallowed: the warm-up is
        // not an assertion, and whether these screens render is smoke.spec.ts's
        // business.
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
}
