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
// would have been worse than nothing here, since this is also a blocking job.
//
// TWO passes, and two is measured rather than picked. Vite announces a re-bundle
// by reloading the page, so main-frame navigations count the reloads. Against a
// cold server this loop sees 5, then 4, 4, 4 — Playwright reports two
// navigations per `goto` at rest, so pass 1 carries one real reload and every
// pass after it is already quiet. One pass would exit with a re-bundle possibly
// still in flight behind the last entry; a third buys nothing but twenty seconds
// an entry.
//
// Terminating on the reload count itself was tried and does not work: there is
// no fixed navigations-per-goto to compare against, so the condition never
// becomes true and the loop spends its whole budget (8.0 min against 6.5 for
// two passes, on the same cold cache).
//
// The routes NOT listed here — /players/pack, /awards, /league and the rest —
// are the argument against being exhaustive. This closes the worst window, the
// very first cold load under two workers. It is not a proof that no route can
// ever trigger a late re-optimise.
//
// This runs after `webServer` is up, because Playwright sets its plugins up
// before global setup.
import { chromium, type FullConfig } from "@playwright/test";

const ENTRY_POINTS = ["/", "/players"];
const PASSES = 2;

export default async function warmUp(config: FullConfig) {
  const use = config.projects[0]?.use;
  if (!use?.baseURL)
    throw new Error("e2e warm-up: no baseURL on the first project, nothing to warm.");

  // The project's own launch options, so a sandbox pointing PLAYWRIGHT_CHROMIUM_PATH
  // at its Chromium warms with the same binary the tests will run.
  const browser = await chromium.launch(use.launchOptions);
  try {
    const page = await browser.newPage({ baseURL: use.baseURL });
    for (let pass = 0; pass < PASSES; pass++) {
      for (const path of ENTRY_POINTS) {
        await page.goto(path);
        // The route chunks land after hydration, which is the part a document
        // load does not wait for. `networkidle` is discouraged for assertions
        // and does settle here — measured at 8-12s against this dev server,
        // well inside the bound; Playwright does not count Vite's HMR socket as
        // traffic. Bounded and swallowed anyway: the warm-up is not an
        // assertion, and whether these screens render is smoke.spec.ts's
        // business.
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
}
