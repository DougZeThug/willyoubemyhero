# Goal: complete the Will YOU Be My Hero? product description

You are working in `product-description/`, inside the `willyoubemyhero` repo.
Read `README.md`, `glossary.md`, `foundations/identity-and-sessions.md` and
`cards/favourites.md` first. The README defines the purpose, the document
template, the method, the structure, and the coverage table. The other three are
the exemplars: match their depth, tone, and structure exactly. Your job is to
write every document in the README's structure until the coverage table has no
`not started` rows, then run a consistency pass.

## Source of truth

The app is the repo this directory sits in, at commit `b46f330`. Describe the
experience on the deployed app, on a phone, in the default configuration, with
nothing customized. `src/components/ui/**`, the generated files, the MCP routes
and the Lovable editor are out of scope; see the README's scope decisions.

For each document, read in this order before writing:

1. The route file in `src/routes/` and the components it renders. This is the
   screen.
2. The hooks it uses in `src/hooks/`. These decide what the screen knows, when it
   learns it, and whether it goes stale.
3. The domain module in `src/lib/` that owns the rules — the one whose header
   comment explains the feature rather than plumbing it.
4. The write path: the `src/lib/*.functions.ts` handler, its guard on the first
   line, and the Postgres RPC behind it in `supabase/migrations/` where there is
   one. The guard is who may do it; the RPC is what the client is not allowed to
   decide.
5. The tests. `src/lib/*.test.ts` for the rules, `tests/db/*.test.ts` for grants
   and RPCs, `e2e/*.spec.ts` for whole journeys. They are close to executable
   specifications of the edge cases.

This codebase explains its own surprises in comments, at length and honestly.
When a behavior is strange and a comment says why, use that reason rather than
inventing one — but say it in the user's terms, not the code's.

Do not describe code. Describe what the user sees and does. Technical detail goes
only in `> Technical note:` block quotes, and only when the mechanism changes what
the user would expect.

## Writing rules

- Follow the eight-section template in the README for every screen, object and
  action document. Foundations and cross-cutting documents may drop sections that
  do not apply, but must still cover cancel and interrupt behavior wherever an
  interaction exists.
- Modifiers and cancel/interrupt go in tables, split by phase (before the first
  write / after it) as in `cards/favourites.md`. The interrupt rows and the order
  of cross-cutting concerns are fixed in the README; do not add, drop, or reorder
  them in a single document.
- Use the glossary's words. If you need a term the glossary lacks, add it to
  `glossary.md` in the right section with a full paragraph, then use it. Do not
  coin a synonym for a term that exists.
- Sentence case for all headings. Direct, concrete language. No hedging, no
  marketing.
- State surprising behavior plainly and say why if the reason is in the code or a
  comment. If it looks like a bug, say so in "Open questions" rather than
  smoothing it over.
- Cross-reference other documents with relative links rather than repeating their
  content. The foundations own their facts; link to them.
- Every document ends with "## Open questions and verification" listing what was
  read from code but not confirmed by hand, followed by
  `Verified against willyoubemyhero commit \`b46f330\`.`
- Mermaid `stateDiagram-v2` for each interaction's states. Keep it to the states
  the user passes through; omit internal bookkeeping.

## Things already established (do not re-derive, do not contradict)

- **Four identities, three tokens.** Guest (90 days), member (90 days), admin
  (12 hours); an account is durability, not a fourth permission level. Every
  token is HMAC-signed and carries its kind inside the signed payload. A member
  token always beats a guest token on the same device.
- **Every write runs as `service_role` and bypasses row-level security.** The
  guard on the first line of the handler is the only thing standing between a
  request and the database. A document should say which guard a screen's writes
  sit behind, because that is what decides whether the button is even there.
- **Never trust a participant id from a request payload.** It comes from the
  verified token. This is why "who you are" is a modifier row rather than
  something a screen asks you for.
- **Three card axes, three vocabularies.** Tier (earned, public, six fixed
  strings), edition (rolled per copy, five metals), level (rolled per secret
  copy, five names). They are never merged and never share words.
- **A special finish takes the headline; the tier drops to the line under it.**
  A standard finish prints nothing extra and the tier keeps the headline.
- **Best wins.** A worse edition of a card you hold is a duplicate, not a
  downgrade. The same rule runs in Postgres, so the device and the server agree
  about which copy you own.
- **The vault sorts on tier first and tie-breaks on edition**, so a platinum DNF
  can never outrank a base champion.
- **Pull rates are identical across the two rolled ladders**: 0.5 / 3.5 / 8 / 18
  / 70 percent. They are stored in basis points so the table sums exactly.
- **Postgres rolls anything worth money.** Editions and secret levels are decided
  server-side, not on the phone, because a value the client chooses is a value
  anybody can reroll by refreshing.
- **A pack is three roster cards plus a secret slot**, seeded on event, league day
  and identity. The last slot prefers a card the baseline lacks. The tear commits
  at 60% of a travel worth 80% of the pack's width.
- **The set size is withheld.** No screen and no server response says how many
  secret cards exist. Do not write a document that implies a total.
- **The dust switch changes the shape of the nav**, from five tabs to six. While
  dust is off every dust call refuses in Postgres, so a stale switch costs a
  button that answers "not yet" and can spend nothing.
- **Times are milliseconds everywhere** and formatted only at the edge. A split
  edited moves every split after it.
- **Six tier strings, six award ids and the streak rungs are persisted** and may
  be added to but never renamed or renumbered.
- **Which document owns which pack state:** `cards/the-stand.md` owns `sealed`
  and the tear; `cards/opening-a-pack.md` owns `opening` and `revealing`;
  `cards/what-you-pulled.md` owns `complete`; `cards/the-daily-secret.md` owns
  the fourth slot in every state, and links rather than restating the ceremony.

## Order of work

1. `cards/favourites.md` as the pilot, then `foundations/` in the order the
   README lists them. Everything else links to these.
2. The pack: `cards/the-stand.md`, `cards/opening-a-pack.md`,
   `cards/what-you-pulled.md`, `cards/the-daily-secret.md`. Read
   `src/routes/players.pack.tsx`, `src/lib/pack.ts`, `src/lib/pack-ceremony.ts`,
   `src/lib/pack-tear.ts`, `src/lib/stand-phase.ts` and the pack components in
   full before writing any of them, because the states hand off to each other and
   the four documents must agree on where one ends and the next begins.
3. The remaining `cards/`, then `trading/`, `dust/`, `combine/`, `admin/`,
   `accounts/`, `cross-cutting/`. These are independent of each other and can be
   drafted in parallel with subagents once the foundations and the pack documents
   exist to link to. If you parallelize, give each subagent this file, the
   exemplars, and the specific document to write; then review every result
   yourself for consistency with the glossary and the established facts above
   before accepting it.
4. Consistency pass over the whole set: same term for the same thing everywhere,
   no two documents describing the same behavior differently, every relative link
   and heading anchor resolves
   (`python3 ../.claude/skills/product-description/references/check-links.py .`),
   every document has a footer, every glossary term used is defined.
5. Update the coverage table in `README.md` as you go: `drafted` when written,
   `verified` only after a hand pass against the running app.

## Working rules

- Commit after each document or coherent group with a message of the form
  `docs: add {path}` or `docs: revise {path}`. Do not name a model in a commit
  message, a document, or anything else pushed to this repository.
- Do not modify anything outside `product-description/`. The app is read-only
  reference material for this work.
- Do not add files outside the README's structure without updating the structure
  and the coverage table to match.
- When a behavior cannot be determined from code and tests, write down what you
  could determine, put the rest in "Open questions", and move on. Do not guess
  and do not block.
- Depth bar: `cards/favourites.md` is roughly 180 lines for a small feature. The
  pack documents will be longer; cross-cutting documents will often be shorter.
  Completeness matters more than length. Every phase, every modifier and every
  interrupt row must be accounted for, even when the answer is "no effect".
- If the README's structure turns out to be wrong for something you discover — a
  document that should be split, two that should merge — make the change, update
  the structure and coverage table, and note why in the commit message.

You are done when the coverage table has no `not started` rows, the consistency
pass is complete, and everything is committed.
