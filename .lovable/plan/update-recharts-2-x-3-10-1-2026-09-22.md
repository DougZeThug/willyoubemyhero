# Update recharts 2.x -> 3.10.1

## Findings
- `recharts` is a runtime dependency (`^2`).
- Only one screen uses it: the analytics page. It draws a bar chart from ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip and CartesianGrid.
- The analytics test replaces recharts with stand-ins, so the tests alone won't show whether the real chart still draws.
- `src/components/ui/chart.tsx` is the stock shadcn chart wrapper. Nothing in the app imports it, but it is still typechecked. Recharts v3 changed the Tooltip and Legend types it relies on, so it will probably fail typecheck.
- The card back panel mentions recharts only in a comment. It doesn't use it.

## Steps
1. Set `"recharts": "^3.10.1"` in package.json.
2. Regenerate both lockfiles: `bun install`, then `npm install --package-lock-only`. If bun and npm resolve different versions because of the 24-hour minimumReleaseAge guard, pin npm to bun's version so the lockfiles match. If that guard blocks v3 entirely, stop and ask.
3. Inspect the installed package's `prepare` script, as the PR notes ask, and report what it does.
4. Run format, lint, typecheck, test and build.
5. If `ui/chart.tsx` fails typecheck, replace it with shadcn's recharts-v3-compatible version of the same file. It stays unused and unmodified-shadcn in spirit, so it gets no tests.
6. Fix any v3 breakages in `analytics.tsx` at the call site. v3 dropped some props (for example `alwaysShow`, and the `activeIndex` prop on Bar and Tooltip). Keep the chart's look the same.
7. Open /analytics in the preview with Playwright on a phone-sized screen. Confirm the bars, axes and tooltip render and the console is clean.
8. Run a dependency vulnerability scan after the bump.

Node 18+ is already satisfied: CI and the Worker runtime are both newer. No database, server or behaviour changes.
