import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5199);
const HOST = "127.0.0.1";

// Some sandboxes ship a Chromium that does not match the build this Playwright
// version expects. Point PLAYWRIGHT_CHROMIUM_PATH at that binary to use it
// instead of downloading one. Unset — the normal case, including CI after
// `playwright install` — Playwright resolves its own browser.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./e2e",
  // Runs once the webServer below is up and before any worker starts. See the
  // file for what it is warming and why a cold start used to fail a run.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // Every screen renders its empty state first and fills in once the client
  // query resolves, so an assertion has to outlast an SSR render plus hydration
  // plus a round trip. The 5s default expires mid-flight and reports the empty
  // state as the final answer.
  expect: { timeout: 15_000 },
  timeout: 60_000,

  // Phone first, because that is how this app is actually used. The desktop
  // project exists to catch a layout that only ever renders at one width.
  // Both projects run Chromium: the iPhone preset would otherwise pull in
  // WebKit, and CI installs one browser. The phone project keeps the preset's
  // viewport, device-scale factor and touch support, which is what the layout
  // and the pack's drag gesture actually depend on.
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium", launchOptions },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
  ],

  webServer: {
    // `vite preview` cannot serve this app: the nitro build targets Cloudflare
    // and writes .output/, while preview looks for dist/server/server.js. The
    // dev server is the thing that actually runs an SSR build locally.
    command: `bun run dev -- --host ${HOST} --port ${PORT}`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Point every Supabase variable at a dead local address. Server functions
      // are intercepted in the browser before they are ever sent, so nothing
      // should reach the network — and if something slips through, it fails
      // loudly here instead of talking to the live project.
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
      VITE_SUPABASE_URL: "http://127.0.0.1:1",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
      SESSION_SECRET: "e2e-session-secret",
    },
  },
});
