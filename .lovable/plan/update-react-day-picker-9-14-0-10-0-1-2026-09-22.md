# Update react-day-picker 9.14.0 -> 10.0.1

The date picker is used only by the stock calendar in the component kit (`src/components/ui/calendar.tsx`). No screen in the app uses it today, so users won't see any change.

## Steps
1. Set `react-day-picker` to `^10.0.1` in package.json. Regenerate both lockfiles (`bun install`, then `npm install --package-lock-only`) and pin them to the same version.
2. Typecheck `calendar.tsx` against v10. If a removed prop, alias or type export breaks it, fix it using the v10 names (for example `startMonth`/`endMonth`, the `Chevron` component and current type exports). Change nothing else.
3. Gate: format, lint (should stay at 110 warnings, 0 errors), typecheck, test (2,818) and build.

## Notes
- No app code, database or server changes.
- The calendar helper has no tests of its own because it's unmodified shadcn code.
