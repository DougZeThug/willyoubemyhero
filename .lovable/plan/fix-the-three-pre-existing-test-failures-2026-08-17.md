# Fix the three pre-existing test failures

All three are stale tests that describe behaviour the app intentionally changed. The
app code is correct; the tests are the thing that is wrong. No production code changes.

## 1 & 2 — Card Prompt Studio: "Subject name" label no longer exists

`src/components/card-prompt-studio.test.tsx` looks up the subject input by the label
"Subject name". When the studio was reworked to always show a name field (and a
conditional team field for the Cornhole series), that label was renamed to **"Name"**
for both the player and the secret/standalone branch. Two tests fail on
`getByLabelText("Subject name")`:

- "switches to a secret series and requires subject plus association"
- "does not associate standalone history with the previously selected player"

**Fix:** update the three lookups to `getByLabelText("Name")`.

The assertion on the generated prompt text — `toContain("Subject name: Pickles")` —
stays exactly as it is. That string is the prompt body written by
`src/lib/card-prompt-templates.ts`, not the form label, and it is still correct.

## 3 — getMySecrets no longer throws at an anonymous visitor

`src/lib/secret-cards.functions.test.ts` still expects
`getMySecrets` to reject with "Claim your player first" when a device carries no
token. It was deliberately changed to return an empty vault (`{ cards: [], pulled: 0 }`)
instead, because throwing blanked the vault on first paint before a member token had
been attached — the same posture `getSecretStatus` already takes.

**Fix:** rewrite that one test to assert the empty-vault answer, and rename it to say
what the rule now is ("an unidentified device gets an empty vault, not an error"),
with a short comment recording why it is not an error so the next reader does not
"fix" it back.

## Verification

`bun run format`, `bun run lint`, `bun run typecheck`, then `bun run test` — the two
files should go fully green with no remaining failures.
