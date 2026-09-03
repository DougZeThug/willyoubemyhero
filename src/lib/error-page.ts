/**
 * The last resort, served by server.ts and start.ts when the app cannot render
 * at all.
 *
 * Self-contained on purpose: no Tailwind, no styles.css, no webfont. It renders
 * precisely when something upstream is already broken, so it asks the network
 * for nothing — Barlow Condensed is requested by name and quietly falls back to
 * whatever condensed face is on the device. The values are the same tokens
 * styles.css sets (--bg, --surface, --primary), inlined because there is no
 * stylesheet here to read them from.
 *
 * Copy is kept in sync with ErrorComponent in src/routes/__root.tsx — the two
 * cover the same failure from opposite sides of the render.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0a1420" />
    <style>
      :root { color-scheme: dark; }
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: oklch(0.13 0.015 240); color: oklch(0.97 0.005 240); display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 1.5rem; background: oklch(0.17 0.02 240); border: 1px solid oklch(1 0 0 / 8%); border-radius: 12px; }
      h1 { font-family: "Barlow Condensed", ui-sans-serif, system-ui, sans-serif; font-size: 1.375rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.02em; margin: 0 0 0.5rem; }
      p { color: oklch(0.78 0.02 230); margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 44px; padding: 0 1.125rem; font: inherit; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; }
      .primary { border-radius: 9999px; border-color: oklch(0.82 0.14 210 / 55%); background: linear-gradient(180deg, oklch(0.22 0.03 235) 0%, oklch(0.16 0.025 240) 100%); color: oklch(0.82 0.14 210); }
      .secondary { border-radius: 10px; border-color: oklch(1 0 0 / 15%); background: transparent; color: oklch(0.78 0.02 230); }
      :focus-visible { outline: 2px solid oklch(0.98 0.01 240 / 85%); outline-offset: 2px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
