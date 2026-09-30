# Add DeepSource configuration

Add a `.deepsource.toml` at the repo root so DeepSource can analyze the project once the repo is activated on deepsource.com (the TOML itself does nothing until the repo is connected there).

## What goes in the file

```toml
version = 1

test_patterns = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "tests/**",
  "e2e/**"
]

exclude_patterns = [
  "src/routeTree.gen.ts",
  "src/integrations/supabase/types.ts",
  "src/components/ui/**",
  "public/progressier.js",
  "product-description/**"
]

[[analyzers]]
name = "javascript"
enabled = true

  [analyzers.meta]
  environment = ["browser", "nodejs", "vitest"]
  plugins = ["react"]
  dialect = "typescript"

[[analyzers]]
name = "secrets"
enabled = true
```

## Rationale

- **javascript analyzer with the react plugin and typescript dialect** covers all app code; DeepSource has no separate TypeScript analyzer.
- **test_patterns** marks the Vitest/db/e2e suites as tests so test-only issues are classed correctly.
- **exclude_patterns** skips generated files (`routeTree.gen.ts`, Supabase `types.ts`), unmodified shadcn primitives, the third-party `progressier.js` snippet, and the `product-description/` docs (which hold Playwright fixtures, not app code).
- **secrets analyzer** is a cheap extra net for accidentally committed credentials.
- No `transformers` — the project already gates on Prettier/ESLint via `bun run lint`; DeepSource autofixing formatting would fight CI.

## Note on "database"

DeepSource analyzes the code repository, not the database itself — the file lives in the repo root. SQL migrations are not covered by any DeepSource analyzer; the existing `tests/db` suite remains the proof for schema changes.

## After the file is committed

1. On deepsource.com, add the GitHub repository and activate analysis.
2. The first analysis runs on the default branch; results appear on the DeepSource dashboard.
3. Optionally enable DeepSource as a PR check later — decide after seeing the first report's noise level.

## Validation

- Run `bun run lint` (Prettier accepts TOML untouched; just confirm nothing else broke).
- No dependency, migration, or app-code changes.
