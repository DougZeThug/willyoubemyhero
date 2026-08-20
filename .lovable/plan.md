# Sammi's secrets, and why new signers still can't trade

## What the database says

Sammi's account is the long-running one, and **nothing has been lost**. Her account is linked to the visitor collection holding all 12 secret cards, last pulled at 21:23 tonight, four minutes before she signed in. The cards, the link and the sign-in are all intact server-side.

So this is not a data loss — it is her phone showing the wrong identity. A visitor's collection is remembered by a token in that browser's storage, and three things wipe or replace it: signing out (the app deliberately clears it), opening the app in a different browser or on a different device, or the account sync failing quietly after sign-in, in which case the app "behaves like the signed-out app" and keeps whatever token the browser happened to mint. Any of those leaves her looking at a brand-new, empty collection while her real one sits safely in the database.

Which of the three it was can only be told from her actual phone, so that is step one rather than a guess.

## Why the new signed-in people still can't be traded with

The collector feature — a signed-in non-player picks a trading name and becomes a real trading party — is built but **has never been published**. The live site still runs the older build, so no one has ever seen the name prompt, and the database confirms it: both new accounts still have no player attached, and there are no collector rows at all. Publishing is the fix.

## Plan

1. **Publish.** This puts the trading-name prompt live for every signed-in non-player, including Sammi.
2. **Sammi opens Trading and picks a name.** That converts her account from a browser-bound visitor into a permanent collector identity, and the existing claim routine carries all 12 secrets across at that moment. From then on her cards follow her account to any phone — this is the durable fix for exactly the symptom she hit.
3. **If her cards still look missing right after that**, check what her phone reports (signed in as which email, how many cards the vault shows) and, if her browser had drifted onto a fresh visitor identity, fold that identity's pulls into hers with the existing merge routine. Data fix only, no code change.
4. **Harden the identity handling** so this cannot recur:
   - Stop wiping the visitor token on sign-out — signing out of an account should not orphan the cards on that handset.
   - Re-run the account sync on each app load instead of latching it once per session, and surface a quiet retry when it fails, so a failed sync stops silently leaving the phone on the wrong identity.

## Technical notes

- Steps 1-3 need no code change: `createCollectorIdentity` already calls `claim_guest_secrets` / `claim_guest_packs` for both the account's stored guest id and the device's current one.
- Step 4 touches `signOutAccount()` and `useAccountSync` in `src/hooks/use-account.ts` only. Dropping `clearGuestToken()` from sign-out is safe: the guest token is a collection pointer, not an authorisation to act as anyone, and the next sign-in's `syncAccount` merges rather than overwrites.
- Nothing in the schema or the trading RPCs changes.
