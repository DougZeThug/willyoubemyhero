# Vault and trade screens say what is actually happening

Four honesty fixes, all in components/hooks/routes. No server functions, migrations or dependencies touched.

## 1. Vault counter waits for account linking

`players.index.tsx` currently passes `ready={mine.ready}` into `VaultHero`, and `useMyCollection` settles as soon as the local store loads when there is no member token. On a freshly signed-in second phone that renders "0 / 13" as a fact.

Read `useAccountSyncState()` (from `src/lib/account-sync-state.ts`, today only read by `/auth`) in the vault route and fold `status === "syncing"` into the same single flag:

```
const ready = mine.ready && sync.status !== "syncing";
```

That one value feeds both `VaultHero`'s `ready` prop and `isLocked`, so the counter stays dashed and every card keeps the locked style until linking settles. No second flag, no change to the hook's contract.

## 2. Vault says so when linking failed

When `status === "error"`, render the state's own message ("Your cards are safe, but this phone could not finish linking them.") as a quiet line in `VaultHero`, in the same place and style as the existing `wasMember` breadcrumb, followed by a "Try again" link to `/auth`.

Implemented as two new optional props on `VaultHero` (`syncError: string | null`), keeping the component prop-driven and renderable in a test with a bag of values, as its header comment requires. The vault route supplies the message.

## 3. Failed trade accept still refreshes the collection

In `players.trade.tsx`, `accept()` awaits `refreshMine()` at the end of the `try`, so a connection dropped after the server already moved the cards leaves the vault, spares and secrets caches stale for up to five minutes behind a "Could not accept" toast. Move `await refreshMine()` into `finally`, keep the existing comment explaining why the refresh matters, and add one line saying why it now runs unconditionally. `resolve()` and `propose()` are left as they are — the ask is scoped to accept.

## 4. Out-of-season copy in the Trading Post

`SparePicker` shows "No spares to trade." whenever the list is empty, including when there is no active event at all. The screen already has `event` from `useEventBundle()`; pass a flag into both pickers and render "Trading opens with the next combine." instead when there is no event. Copy only — whether secrets should trade out of season stays open (B-33).

## Tests

- `src/components/vault-hero.test.tsx`: counter stays dashed while syncing; the error line renders with its message; the "Try again" action points at `/auth`; nothing extra renders when sync is idle.
- `src/hooks/use-my-collection.test.tsx`: untouched unless the syncing flag ends up routed through the hook — the plan keeps it in the route, so no change expected.
- Trade out-of-season copy: one case beside the trade screen's existing tests (or `e2e/trades.spec.ts` if the picker is not unit-renderable in isolation), following the patterns already in those files.

Gates: `bun run format`, then `bun run lint`, `bun run typecheck`, `bun run test`.

## Pull request

Branch off main, commit the four changes, and open a PR titled `fix: vault and trade screens say what is actually happening`, body naming the four changes and linking `docs/confidence-report.md` (Tier 2.4 and B-33). Not merged.

Note: this environment's git state is managed by Lovable and syncs to the connected branch. If PR creation from here is not possible, the changes land on the connected branch instead and I will say so plainly rather than claim a PR exists.
