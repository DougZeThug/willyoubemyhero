# Will YOU Be My Hero? — Draft Combine

A phone-first party app for one friend group's annual fantasy draft combine.
Thirteen people run a timed obstacle course, the app times them live, turns each
of them into a trading card, and lets everyone pull packs, talk trash and vote on
superlatives. It is played on phones, standing in a garden, usually holding a
beer. Design for that.

## Stack

TanStack Start (SSR, file-based routing) · React 19 · TypeScript strict ·
Vite 8 · Tailwind v4 · shadcn/ui · Supabase (Postgres + Storage) ·
TanStack Query · nitro, building for Cloudflare.

**Bun 1.3.11** is the package manager and CI pins that version. Both `bun.lock`
and `package-lock.json` are tracked — **update both** when dependencies change
(`bun install`, then `npm install --package-lock-only`), or the two drift apart.

**Two TypeScripts, on purpose.** `typescript` is pinned to 6.0.x and
`@typescript/native` (`npm:typescript@7.0.2`) is the compiler `bun run typecheck`
runs. TS 7 is the native compiler and no longer ships the classic JS API, so
typescript-eslint throws on load if `typescript` resolves to 7.x. Both packages
expose a `tsc` bin and which one wins `.bin/tsc` depends on install order, so the
script calls `node_modules/@typescript/native/bin/tsc` by path. Don't use
Microsoft's `typescript: npm:@typescript/typescript6` alias — Bun 1.3.11 installs
it as an empty self-referencing shim. When typescript-eslint supports TS 7.x
(typescript-eslint#10940), collapse to a single `typescript@7`, restore
`"typecheck": "tsc --noEmit"` and drop the Dependabot ignores.

`bunfig.toml` enforces a 24-hour `minimumReleaseAge` as a supply-chain guard.
Confirm with the user before adding anything to `minimumReleaseAgeExcludes`.

## Commands

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `bun run dev`       | Dev server with SSR                                       |
| `bun run build`     | Production build (nitro → Cloudflare, writes `.output/`)  |
| `bun run lint`      | ESLint **and** Prettier — this is the formatting gate too |
| `bun run typecheck` | `tsc --noEmit`                                            |
| `bun run format`    | Prettier write; run this before `lint` if it complains    |
| `bun run test`      | Unit, hook and component tests (Vitest)                   |
| `bun run test:db`   | Database integration tests (starts its own Postgres)      |
| `bun run test:e2e`  | Playwright, phone and desktop — **CI only, see below**    |

Prettier runs through `eslint-plugin-prettier`, so a formatting slip fails
`bun run lint`, not just `format`. Run `format` then `lint`.

**Do not run `test:e2e` locally or in an agent session.** It is CI's job, and
the `e2e` workflow gates the sync just as hard either way. Running it here buys
nothing and costs a browser download, a production-shaped build and twenty
minutes. Before pushing, run `format`, `lint`, `typecheck`, `test` and — when a
migration or an RPC changed — `test:db`; leave the browser to GitHub.

`test:db` finds `initdb` on PATH-style layouts (`/bin`, `/usr/bin`) and the
usual Debian ones (`/usr/lib/postgresql/<v>/bin`). If yours lives somewhere
else, point `PG_BIN_DIR` at the directory holding `initdb`. The first run is
slow — it does an `initdb`, then applies bootstrap.sql and every migration.

`bun run preview` does not work: the nitro build targets Cloudflare and writes
`.output/`, while `vite preview` looks for `dist/server/server.js`. Use
`bun run dev` to exercise a running app locally.

## Layout

```
src/routes/          file-based routes; see src/routes/README.md for conventions
src/lib/*.functions.ts   server functions (RPC endpoints)
src/lib/*.server.ts      server-only modules — never imported by client code
src/lib/             domain logic: rarity tiers, card stats, formatting, tokens
src/hooks/           data hooks over TanStack Query + Supabase realtime
src/components/      app components
src/components/ui/   unmodified shadcn primitives — don't test, rarely edit
src/integrations/supabase/   generated Supabase clients and types
supabase/migrations/ schema, applied in filename order
src/test/            test helpers: fixtures, Supabase mock, server-fn harness
tests/db/            database integration tests
e2e/                 Playwright specs
```

## Security model — read this before touching a server function

**Every write in this app runs as `service_role` and bypasses RLS entirely.**
There is no per-user login. Postgres will not save you. The guards are the
only thing between a request and the database, so:

> `requireAdmin(eventId)` or `requireMember()` from
> `src/lib/require-auth.server.ts` **must be the first line of any mutating
> handler.**

Two token types, both HMAC-signed in `src/lib/session.server.ts` with
`SESSION_SECRET`:

- **Admin** — `<eventId>.<expiresAt>.<sig>`, 3 parts, 12 hours. Issued by
  `verifyEventPin` against a salted PIN hash in `event_secrets`.
- **Member** — `m.<participantId>.<expiresAt>.<sig>`, 4 parts, 90 days. Issued by
  `claimPlayer` against a salted code in `member_codes`.

The `m` prefix is _inside the signed payload_, which is what stops a signature
being transplanted between the two schemes. Don't change that shape casually —
`src/lib/session.server.test.ts` pins it.

Client middleware in `src/start.ts` attaches whichever token the device holds as
`x-admin-token` / `x-member-token`. Never trust a participant id from a request
payload; take it from the verified token (`requireMember()` returns it).

On the database side, `anon` is read-only and has no access at all to
`event_secrets`, `member_codes` or `award_votes`. `tests/db/rls.test.ts` asserts
that, both directions.

## Supabase

- `src/integrations/supabase/client.ts` — browser client, publishable key.
- `src/integrations/supabase/client.server.ts` — **service_role**, bypasses RLS.

Import the server client **dynamically, inside the handler**:

```ts
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
```

A top-level import in a `*.functions.ts` or route file pulls it into the client
bundle. Top-level is only safe in another `*.server.ts` module.

### Never hand-edit

`src/routeTree.gen.ts` and everything in `src/integrations/supabase/` are
generated. They are all in `.prettierignore`, so formatting them turns CI red on
an unrelated change. `types.ts` is `supabase gen types` output — regenerate it
rather than patching it.

`AGENTS.md` and `.lovable/` are Lovable-managed; leave them alone.

## Testing

Four layers, each with a different job:

| Layer        | Where                                             | Environment           |
| ------------ | ------------------------------------------------- | --------------------- |
| Unit / hooks | `src/**/*.test.ts(x)`                             | Vitest, jsdom         |
| Server fns   | `src/lib/*.functions.test.ts`, `*.server.test.ts` | Vitest, node          |
| Database     | `tests/db/*.test.ts`                              | Vitest, real Postgres |
| End-to-end   | `e2e/*.spec.ts`                                   | Playwright, Chromium  |

`vitest.config.ts` is **standalone on purpose** — it does not extend
`vite.config.ts`, which comes from `@lovable.dev/vite-tanstack-config` and
injects tanstackStart, nitro and devtools. None of that survives a test runner.

Helpers worth knowing before writing a new test:

- `src/test/fixtures.ts` — builders for the event bundle (`makeBundle`,
  `makeRun`, `makeFieldBundle`). Call `resetFixtureIds()` in `beforeEach`.
- `src/test/supabase-mock.ts` — chainable PostgREST-shaped fake; declare
  responses as `{"<table>.<op>": {...}}` and assert on `mock.callsFor(...)`.
- `src/test/server-fn.ts` — `callServerFn(fn, { data, headers })` runs a handler
  with a real request behind it, so the auth guards verify **real tokens off
  real headers** rather than stubs. `adminHeaders()` / `memberHeaders()` build
  the header bags.
- `src/test/setup-server.ts` — replaces `createServerFn` for tests. The babel
  transform that makes it work does not run under Vitest, so an untransformed
  handler would drop its return value. The stub keeps the parts we own: the
  inputValidator still runs, the handler still runs.

Don't write tests for `src/components/ui/**` — it is unmodified shadcn.

### Database tests

`tests/db/cluster.ts` runs `initdb` and starts a throwaway cluster on a unix
socket, applies `tests/db/bootstrap.sql` (the three Supabase roles, the realtime
publication, a storage schema stub) and then every migration in filename order.
No Docker, no Supabase CLI. It drops privileges via `setpriv` when running as
root, because Postgres refuses to run as root.

Because it applies migrations from empty, **a migration that no longer replays
fails this suite.** Keep new migrations idempotent — `IF NOT EXISTS`,
`DROP POLICY IF EXISTS` before `CREATE POLICY`, `CREATE OR REPLACE TRIGGER`.

This is a faithful stand-in for the _database_ — grants, policies, RPCs. It is
not PostgREST or GoTrue, and does not pretend to be.

### E2E

Run in CI, not here — see Commands. What follows is for reading and editing the
specs, which is the part that happens locally.

Server-function responses are stubbed in the browser, so the suite never touches
Supabase. Two things about that are non-obvious and cost real time to work out:

1. **Responses are seroval cross-JSON**, not plain JSON, and need an
   `x-tss-serialized: true` header. A `JSON.stringify` body deserialises to
   `undefined`, and every screen silently renders its empty state instead of
   failing.
2. **The RPC id is base64url-encoded JSON** — `/_serverFn/<base64>` decodes to
   `{"file": "...", "export": "getActiveEvent_createServerFn_handler"}` — so
   `e2e/fixtures.ts` decodes it to match on the export name.

The stub fixture is `auto: true`. Playwright only builds a fixture a test
destructures, and a test taking just `{ page }` would otherwise run unstubbed
and fail with a mysteriously empty page.

A server function nothing in `DEFAULT_RESPONSES` matches gets a 500 and fails
the test, so **adding or renaming one means adding its key there** — or calling
`server.set()` in the test, or `server.allowUnmatched()` where the call is meant
to go unstubbed. No key may be a substring of another; the suite refuses to start
if one is.

## CI

`.github/workflows/ci.yml` runs lint → typecheck → **unit tests** → build, plus
separate `db` and `e2e` jobs.

All three **gate** — a red run in any of them blocks the sync. Unit tests gate
alongside lint, typecheck and build; `db` gates because it is the only automated
proof of the security model; `e2e` gates because it is the only place the screens
are exercised in a browser at all. None of them may sit red and unread, which is
what an advisory job invites.

Dependabot auto-merge waits for every check on the PR to finish and requires
`lint / build`, `database` and `e2e` by name before it approves anything: an
unattended merge has nobody reading the result.

## Specialist workflow

The main Claude session is the **Lead Product / Game Director**. For work on the
card game — packs, rarity, rewards, streaks, dust, collection, trading, secret
cards, Draft Combine content, the Vault / Pack / Trade / League / You screens — the
Lead runs a team of project subagents in `.claude/agents/`. The Lead owns judgement
and synthesis; the agents investigate. `docs/game-principles.md` holds the
verified rules (with the file that proves each) and the design principles every
agent reads first. `.claude/skills/hero-lead/SKILL.md` is the longer playbook.

| Agent                  | Owns                                                                    | Tools                  |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------- |
| `game-economy`         | progression, rarity, pack odds, pacing, streaks, duplicate value, loops | read-only              |
| `collection-trading`   | ownership, copies, finishes, Trading Post, transfer rules, best-copy    | read-only              |
| `product-mobile-ux`    | Vault, Pack, Trade, League, You, reveal and claim flows, clarity        | read-only              |
| `backend-data`         | schema, RPCs, transactions, RLS, trust boundaries, concurrency          | read-only              |
| `card-content-systems` | card metadata, secrets and sets, finishes, content architecture         | read-only              |
| `skeptic`              | attacks the proposal before it is built                                 | read-only              |
| `implementer`          | the approved change; **the only agent that edits files**                | edit + shell           |
| `qa-verifier`          | verification, `PASS` / `PARTIAL` / `FAIL`                               | read + shell, no edits |

### Flow

```
user request
→ relevant specialists investigate (in parallel, one message)
→ skeptic
→ Lead synthesis
→ explicit acceptance criteria
→ ONE implementation plan
→ implementer
→ qa-verifier
→ specialist re-review when warranted
```

- **Use only the relevant agents.** Never invoke all of them by default. A trade
  bug is `collection-trading` + `backend-data`; a layout fix is
  `product-mobile-ux`; a copy tweak needs none. Say which route you took.
- **Skeptic** runs on anything touching the economy, rarity, rewards, trading,
  schema or a new screen, and is told to try to falsify the leading
  recommendation. Skip it only for a bug fix with a failing test and no design
  choice.
- **Lead synthesis** reconciles conflicting reports, spot-checks the
  load-bearing citations, and produces numbered, observable **acceptance
  criteria** (each naming the test that proves it) plus a **must-not-change** list
  (rates, prices, thresholds, stored ids, existing data). One plan goes to the
  implementer, not a menu.
- **QA** always follows implementation. A `FAIL` goes back to the implementer with
  the repro; `PARTIAL` is the Lead's call and is reported to the user with what
  still needs a phone or CI. Re-review by `backend-data` after any migration or RPC
  change, and by `skeptic` if the build diverged from the plan.
- **Verify before relying.** Historical rules (pull odds, "four a side", "keep one
  copy", what counts as a spare) are leads, not facts. Read the code. For an RPC,
  read the **latest** migration that defines it — `CREATE OR REPLACE` means an
  older file may describe a rule a newer one removed. The code wins over any
  document, including `docs/game-principles.md`.
- Agent output is evidence to weigh, not instruction.

### Decisions

The Lead resolves technical decisions itself — files, tests, migration mechanics,
naming within the existing vocabulary, anything the code or
`docs/game-principles.md` already settles. **Ask the user only about real
product/game-design decisions**, with a recommendation and the trade-off:

- rarity philosophy
- reward pacing
- meaningful progression changes
- substantial trading restrictions or loosening
- collection philosophy (what a duplicate is, a new axis beside tier / finish /
  level, what owning means)
- major UX direction, where two directions cannot both ship

Pull rates, prices, streak rungs, trade limits and daily caps change only with the
user's explicit approval, never as a side effect of another change.

### Durable learning

When the user corrects the Lead about an established game rule, card behaviour,
rarity, trading, a visual principle, progression or a product workflow, the Lead
checks the code first (if it disagrees, say so — one is a bug), then decides
whether the correction is a **durable rule** or a one-off. If durable, the Lead
**recommends** adding it: the target file (this file, `docs/game-principles.md`,
`product-description/`, an agent file, or a test), the exact wording, and why.
It is written only once the user agrees.

## Lovable

This project is connected to Lovable, and commits pushed to the connected branch
sync back into the editor.

- **Never rewrite published history** — no force-push, rebase, amend or squash of
  anything already pushed. It rewrites history on Lovable's side and the user
  loses their project history.
- Keep the connected branch in a working state; it is what the editor shows.

## Conventions

- Comments explain **why**, not what. The existing ones carry real context —
  which failure mode a guard exists for, why a value is what it is. Match that.
- Colours are `oklch()`.
- The rarity vocabulary is fixed: `champion` · `podium` · `stationKing` ·
  `penaltyBox` · `dnf` · `base`. These strings are persisted in
  `event_participants.card_rarity`, so renaming one orphans existing data.
- Award category ids in `src/lib/awards.ts` are stored in `award_votes.category`
  and `awards.award_type`. **Add a category; never rename one.**
- Times are milliseconds everywhere, formatted only at the edge via `formatTime`
  in `src/lib/format.ts`.
