// Standalone test config — deliberately NOT extending vite.config.ts.
//
// The app's Vite config comes from @lovable.dev/vite-tanstack-config, which
// injects the tanstackStart plugin, nitro, devtools, and sandbox port detection.
// None of that survives being loaded into Vitest, so the test pipeline is built
// from the two plugins that actually matter here: React (for JSX in component
// tests) and tsconfig paths (for the `@/` alias).
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// Server-side modules and the server-function handlers. Anything that reaches
// for node:crypto or @tanstack/react-start/server belongs here.
const NODE_TESTS = ["src/**/*.server.test.ts", "src/**/*.functions.test.ts"];

export default defineConfig({
  plugins: [react()],
  // Vite 8 resolves the `@/` alias from tsconfig natively, so the app's
  // vite-tsconfig-paths plugin is neither needed nor wanted here.
  resolve: { tsconfigPaths: true },
  test: {
    // The committed .env points at the live Supabase project. Overriding every
    // var a test could reach for means a mock that accidentally falls through
    // hits localhost and fails, rather than talking to production.
    env: {
      SESSION_SECRET: "test-session-secret",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      // Generated files and unmodified shadcn primitives would drown the report
      // in code nobody here wrote.
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "src/components/ui/**",
        "src/integrations/supabase/**",
        "src/routeTree.gen.ts",
        "src/test/**",
        "e2e/**",
        "tests/**",
        "*.config.ts",
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: NODE_TESTS,
          setupFiles: ["./src/test/setup-server.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [...configDefaults.exclude, ...NODE_TESTS],
          setupFiles: ["./src/test/setup.ts"],
          // The default 5s is fine for a file run on its own and not fine for
          // the same file run alongside 90 others: a userEvent-driven render can
          // sit behind the pool for seconds. A timeout here is doubly expensive
          // because the aborted test skips cleanup, so the NEXT test finds two
          // copies of the component mounted and fails on "found multiple".
          testTimeout: 20_000,
        },
      },

      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["./tests/db/globalSetup.ts"],
          // A local Postgres round trip is slower than a unit test, and the
          // suites share one database — running them in parallel would have
          // them clobbering each other's seed data.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
