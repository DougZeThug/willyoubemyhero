# Dependabot production-dependencies group — 38 updates

Apply all 38 bumps from the PR (mcp-js 3.1.0, 27 Radix packages, supabase-js 2.118.0, react-query 5.104.3, react-router 1.170.44, react-start 1.169.2, router-plugin 1.168.46, lucide-react 1.58.0, react/react-dom 19.3.1, react-hook-form 7.90.0, react-resizable-panels 4.14.5, zod 4.6.7).

## Steps

1. Check bun.lock first; bump all 38 in `package.json`, keeping each entry's version style (TanStack packages stay exact-pinned). Keep react and react-dom on the same version.
2. `bun install`. Accept anything the 24-hour release-age guard holds back and report it (no new excludes without asking).
3. Regenerate `package-lock.json` pinned to bun's resolved versions; confirm all 38 match across both lockfiles.
4. Gate: `format`, `lint` (0 errors, ~108 warnings), `typecheck`, `test`, `build`.
5. Phone-sized preview smoke of /players, /players/pack, /players/shop, /league plus opening one dialog/drawer (Radix minor bumps).
6. Run the dependency scan: check whether mcp-js 3.1.0 finally clears the known @modelcontextprotocol/sdk and esbuild findings.
7. Report resolved versions, held-back packages, gate and scan results. Merge happens on GitHub.

## Out of scope

- No source changes unless a bump breaks the gate; fix only that.
- No `test:e2e` (CI only).
- Leave the unrelated changed `product-description/verification/cross-cutting.md` alone.
