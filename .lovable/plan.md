# Accounts: sign in and keep your cards

Today a phone's identity lives entirely in local storage: either a member token (a
claimed roster player) or a server-minted guest token. New handset, cleared browser —
the collection is gone. This adds real accounts on top of that, without disturbing the
token machinery every server function already depends on.

## What the user gets

- A `/auth` page with Google sign-in and email/password sign-up + sign-in.
- Accounts are optional. Signed-out guests keep pulling exactly as today.
- Signing in on a device that already has cards silently absorbs them into the account.
  Nothing is lost, no prompt.
- Signing in on a second device restores the same collection: pulls, secrets, trades,
  daily-pull state.
- Header shows the signed-in state with a sign-out action.

## How identity is preserved

The account does not replace the token — it *remembers* it. Each account gets one
stored identity:

```text
account (auth user)
   └── identity: either a claimed participant  (member token)
                 or a guest id                 (guest token)
```

On sign-in the server:

1. Looks up the account's stored identity.
2. If the account has none, it adopts whatever this device is holding — the member
   token's participant, or the guest token's guest id — and stores that. Nothing moves,
   so nothing can be lost.
3. If the account already has an identity and the device is holding a *different* guest
   id, that guest's secret pulls are merged into the account's identity, mirroring the
   existing `claim_guest_secrets` merge (duplicates collapse, better rarity tier wins).
4. Returns the correct signed token for the account's identity, which the client stores.

Because the returned token is an ordinary member/guest token, every existing server
function, guard, RPC and hook keeps working untouched.

Claiming a roster player with a paper code while signed in upgrades the account's
identity from guest to participant, and carries the guest secrets across using the merge
that `claimPlayer` already performs.

Sign-out clears the Supabase session and the device tokens, then mints a fresh guest
identity so the phone can still pull.

## Technical detail

Database (one migration):

- `public.account_identities` — `user_id` (primary key, the auth user), nullable
  `participant_id`, nullable `guest_id`, timestamps, a check that exactly one is set.
  Deny-all to `anon`/`authenticated` (service_role only), consistent with every other
  private table here; all access goes through guarded server functions.
- `merge_guest_pulls(_into_guest uuid, _from_guest uuid)` — guest→guest twin of
  `claim_guest_secrets`, same duplicate/tier rules. Idempotent, `IF NOT EXISTS` style so
  the db test suite can replay it.

Server functions, in a new `src/lib/account.functions.ts`:

- `syncAccountSession` — `requireSupabaseAuth`, runs the four steps above, returns
  `{ kind: "member" | "guest", token, expiresAt, name }`.
- `getAccount` — who am I, for the header.
- Guarded exactly like the rest of the app; the auth user id comes from the verified
  bearer, never from the payload.

Client:

- `src/routes/auth.tsx` — public route, Google button via
  `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })`
  plus email/password forms, sonner toasts, `head()` metadata.
- `src/hooks/use-account.ts` — wraps the Supabase session and calls `syncAccountSession`
  on `SIGNED_IN`, storing the returned token via `setMemberToken` / `setGuestToken`.
- Single `onAuthStateChange` subscriber in `src/routes/__root.tsx` (filtered to
  `SIGNED_IN` / `SIGNED_OUT` / `USER_UPDATED`) that invalidates the router and query
  cache.
- `src/components/site-nav.tsx` — session-driven sign-in / account affordance and
  sign-out that cancels and clears queries before navigating.
- `claimPlayer` gains an optional account link when a Supabase session is present.

Provider config: Google is enabled through the social-login tool in the same change;
email/password stays on, with confirmation emails at their default (sign-up asks the
user to confirm before the session exists).

Tests: unit coverage for the identity-adoption branches in `account.functions.test.ts`
using the existing `callServerFn` harness, and a db test for `merge_guest_pulls`
alongside the existing secret-card suite.
