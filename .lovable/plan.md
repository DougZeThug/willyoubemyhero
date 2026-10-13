# Dependabot production-dependency group — 34 updates (#188)

Routine grouped update, all minor or patch. No app code or database changes are expected.

## Current state (verified in package.json)

- 27 Radix UI packages: their floors sit well below the PR's "From" column. The lockfiles already resolve them higher, so this mostly raises the floors.
- The three TanStack packages are pinned exactly: router 1.170.41, start 1.168.60, router-plugin 1.168.42.
- The others are caret ranges: @lovable.dev/mcp-js ^3.0.4, @supabase/supabase-js ^2.117.2, idb ^8.0.3, lucide-react ^1.50.0, react-resizable-panels ^4.14.1.
- None of the 34 is on the major-version ignore list.

## Steps

1. **package.json**: set all 34 to the PR's "To" versions.
   - Keep the caret style on caret entries.
   - Keep the three TanStack packages exact: 1.170.42, 1.168.61 and 1.168.43.
2. **Regenerate both lockfiles**: run `bun install`, then `npm install --package-lock-only`.
   - If bun's 24-hour `minimumReleaseAge` guard holds a version back, pin npm to bun's resolved version so the two lockfiles match. lucide-react 1.55.0 and the Radix minor releases are the likely candidates.
   - Do not add exclusions without asking.
3. **Gate**: `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.
   - Watch the tests for dialogs, sheets, popovers, tooltips, sliders, scroll areas and selects.
   - Watch the card-prompt-studio dropdown tests too; they have flaked before.
4. **Dependency scan**: re-run it and confirm that @lovable.dev/mcp-js 3.0.5 still resolves the previously fixed transitive versions.
5. **Preview smoke check**: open /players, a pack reveal, /players/shop and one dialog or drawer. This confirms that overlays, focus handling and routing still work.
6. `test:db` is not affected (no migration or RPC change). `test:e2e` runs in CI only.

## Out of scope

- No app code, migrations, `bunfig.toml` or `.github/dependabot.yml` changes.
- The pre-existing lint warnings and the known @modelcontextprotocol/sdk advisory stay as they are.

## Risks

| Risk | Mitigation |
| --- | --- |
| Radix minor releases (dialog, popover, tooltip, slider, slot, scroll-area, navigation-menu) change overlay, focus or `asChild` behaviour | Full unit suite plus a preview smoke check of dialogs and drawers |
| The 24-hour release-age guard holds back a version | Pin npm to bun's resolution; ask before any exclusion |
| TanStack Start patch release breaks server functions | Full suite, build and preview smoke check |
