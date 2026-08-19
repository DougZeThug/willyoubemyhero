# Anonymous trade tap goes to sign-up

## What happens today
The Trade button on the players page always links to `/players/trade`. When the visitor has no player token and is not signed in, that page renders a small "Claim your player to trade cards" notice — a dead end for someone who has never claimed anything.

## What changes
An anonymous visitor who taps Trade lands on the account screen instead, already switched to the create-account view, with a short line explaining that trading needs an account. Anyone with a player token or a signed-in account keeps going straight to the Trading Post as before.

Nothing changes for claimed players, signed-in players, or the trading flow itself.

## Technical notes
- `src/routes/players.trade.tsx`: in the existing `if (!me)` branch, also read the account state via `useAuthUser()`. While `loading` is true, keep the current quiet frame (no flash-redirect). Once resolved, if there is no member session and no signed-in user, `navigate({ to: "/auth", search: { mode: "signup", next: "/players/trade" }, replace: true })` from an effect rather than rendering the dead-end card. If there is a signed-in user but the member sync has not landed yet, keep the current notice.
- `src/routes/auth.tsx`: accept optional `mode` and `next` search params via `validateSearch`; seed the existing `Mode` state from `mode` and, after sign-in, navigate to a sanitised same-origin `next` path (defaulting to `/players` as today). Only allow paths beginning with a single `/`.
- Keep the Trade button on `src/routes/players.index.tsx` as a plain `<Link>` — the routing decision lives on the trade route so a deep link behaves the same way.
