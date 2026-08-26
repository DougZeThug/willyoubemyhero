// Config for the scripted verification pass.
//
// Separate from the app's own playwright.config.ts on purpose: that one has
// testDir "./e2e", so this pass never joins `bun run test:e2e` and never gates
// CI. It reuses the app's server-function stubbing, so nothing here reaches
// Supabase.
//
//   bunx playwright test --config=product-description/verification/scripted/playwright.config.ts
//
// On a machine whose Chromium is not the build this Playwright expects, point
// PLAYWRIGHT_CHROMIUM_PATH at the binary rather than downloading another.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5211);
const HOST = "127.0.0.1";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: ".",
  // One worker: several items assert on this device's storage, and parallel
  // workers would be several devices.
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://${HOST}:${PORT}`, trace: "off", screenshot: "off" },
  // Every screen renders its empty state first and fills in once the client
  // query resolves, so an assertion has to outlast SSR plus hydration plus a
  // round trip.
  expect: { timeout: 15_000 },
  timeout: 60_000,
  // Phone only. This is a phone-first app and the desktop layout is not the
  // surface these documents describe.
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", launchOptions } },
  ],
  webServer: {
    command: `bun run dev -- --host ${HOST} --port ${PORT}`,
    cwd: "../../..",
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
    // Every Supabase variable points at a dead address. Server functions are
    // intercepted in the browser before they are sent, so nothing should reach
    // the network — and anything that slips through fails loudly here instead of
    // reaching the live project.
    env: {
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
      VITE_SUPABASE_URL: "http://127.0.0.1:1",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
      SESSION_SECRET: "e2e-session-secret",
    },
  },
});
