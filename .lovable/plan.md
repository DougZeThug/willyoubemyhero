# Issue codes only for unclaimed players

Today the only button re-issues a code for every active player, which invalidates codes already handed out. Add a second, safer action that touches only players who have not claimed yet.

## Behaviour

- Two buttons in Member Codes:
  - **Issue codes for unclaimed** (primary) — generates fresh codes only for players with no code row, or with a code row that has never been claimed. Anyone already claimed keeps their existing code untouched.
  - **Re-issue ALL codes** (secondary/destructive-looking) — the current behaviour, still behind the existing confirm dialog.
- The unclaimed action's confirm text says exactly who it affects and that claimed players are untouched. If nobody is unclaimed, it shows a toast ("Everyone has claimed") and does nothing.
- The results list after issuing shows only the codes just generated, as it does now.

## Technical

- `src/lib/member.functions.ts` → `generateMemberCodes`: add optional input `scope: "all" | "unclaimed"` (default `"all"`, keeps existing callers/tests valid). When `"unclaimed"`, read `member_codes` (participant_id, claimed_at) and filter targets down to participants whose row is missing or has `claimed_at === null` before the upsert loop. Explicit `participantIds` still wins if provided.
- `src/components/member-admin-panel.tsx`: split `onGenerate` into `onGenerateUnclaimed()` and `onReissueAll()`, render two buttons, and derive the unclaimed count from the existing `claims` query + roster for the button label/meta.
- No database migration required.
