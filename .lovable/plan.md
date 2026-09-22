# @vitejs/plugin-react 6.1.0 — already covered

The app is already on **6.1.1** (newer than this PR's 6.1.0), applied in an earlier update:

- package.json: `^6.1.1`; bun.lock and package-lock.json both at 6.1.1.
- Vite is `^8.2.2`, meeting the new Vite 8 requirement.
- The plugin is only used for test JSX compilation; nothing relies on Babel plugins, so `@rolldown/plugin-babel` is not needed.

## Plan
- No code or lockfile changes.
- Close this Dependabot PR on GitHub as superseded (merging it would downgrade to 6.1.0).
