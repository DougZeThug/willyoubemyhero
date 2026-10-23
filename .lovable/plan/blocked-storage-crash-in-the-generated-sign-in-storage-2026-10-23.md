# Blocked-storage crash in the generated sign-in storage

## The constraint

`src/integrations/supabase/previewAuthStorage.ts` (and `client.ts`, which calls it) are Lovable-generated. Both the platform rules and this project's own notes forbid hand-editing them: the file is rewritten by the platform, so a local try/catch would be silently reverted on the next regeneration, and editing it would also break the "never touch generated files" rule CI and Prettier rely on.

The diagnosis itself is right. Besides the bare `return localStorage` in the non-brokered branch, the brokered branch has the same gap: `setItem` calls `localStorage.setItem` unguarded and `getItem` falls back to an unguarded `localStorage.getItem`.

## Proposed approach

1. Do not edit the generated file. Report the bug to Lovable as a generator fix: in the non-brokered branch, probe `localStorage` in a try/catch and return an in-memory `{getItem,setItem,removeItem}` Map store on failure; guard the two remaining raw accesses in the brokered branch the same way `readLocal` does.
2. App-side containment, without touching generated code: the browser client is only reached from `auth.tsx`, `use-account.ts`, `account-bridge.tsx`, `use-trades.ts`, `use-collection-trophies.ts`, `event-channel.ts` and `nudge-channel.ts`. Wrap first access in those modules in a small `getBrowserSupabase()` helper (new `src/lib/browser-supabase.ts`) that catches the construction error and returns `null`, so realtime channels and sign-in degrade to "unavailable" instead of crashing the page. Pack opening, the vault and timing go through server functions and are unaffected.
3. Add a unit test that stubs `window.localStorage` to throw `SecurityError` and asserts the helper returns `null` and the vault/trade hooks render their offline state.

## Not changing

Generated files under `src/integrations/supabase/`, auth flow, tokens, any game rules.
