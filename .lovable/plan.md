# Finish the 38-update production bump: TanStack Start 1.169

## Where things stand

37 of the 38 updates are already in the project; both lockfiles match. The one left is `@tanstack/react-start`, still at 1.168.61. Last time, moving it to 1.169.2 broke 281 type checks and 624 tests. It changed how server calls return their results, and removed something the test helper uses to run server calls in tests.

## Plan

1. **Find out exactly what changed.** Apply 1.169.2 (the version the update asks for), then read its release notes and the changed type definitions. Group the errors by cause rather than fixing them one at a time. These first findings decide the scope of steps 2 and 3.
2. **Repair the test helper.** Update the stand-in that tests use in place of `createServerFn`, and the `callServerFn` helper, for the new internals. The rule stays the same: input checks and the handler both still run, and the auth guards still check real tokens.
3. **Fix the app code that depends on the old result shape.** That covers server functions, and any hooks or components that read their results. No changes to behaviour, guards, pull rates, prices or saved data.
4. **Check the end-to-end test stubs.** The browser tests mock server-call responses in a special encoded format. If 1.169 changed that format or the request IDs, update the stub fixture so CI's e2e job stays green.
5. **Lockfiles.** Update both bun.lock and package-lock.json to the same version, keeping the 24-hour safety wait. Also try again to line up react-resizable-panels (4.14.5 in bun, 4.14.6 in npm).
6. **Gate:** format, lint (0 errors, no new warnings), typecheck, all unit tests, production build. Then load the live, players, pack, shop, league and You pages at phone width, with no console errors. Also make one real server call: unlock admin with the PIN and save a result on a test run, or the closest safe equivalent.

## Fallback

If a required fix turns out to be a big rework (for example, the new version needs a different server setup), stop after step 1. Then report what it would take, keep 1.168.61, and leave the update for a separate upgrade job.

## Must not change

Security guards (`requireAdmin`, `requireMember`), token formats, game rates and prices, the database, and the other 37 updates already applied.
