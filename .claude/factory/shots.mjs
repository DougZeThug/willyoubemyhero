#!/usr/bin/env node
// Before/after screenshots for a factory task.
//   node .claude/factory/shots.mjs <task-id> [--scenes a,b] [--base <ref>]
//
// Runs the project's capture spec (.factory/project.json "shots.spec") twice:
// "before" inside a throwaway git worktree of the base commit, "after" in the
// current tree. PNGs and a compare.md land in .factory/evidence/<task-id>/shots/.
// The spec is project-specific (it knows the app's screens); this runner is not.
// process.exit is deliberate: this is a CLI whose exit code is its API.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const config = JSON.parse(fs.readFileSync(path.join(root, ".factory/project.json"), "utf8"));
const args = process.argv.slice(2);
const taskId = args.find((arg) => !arg.startsWith("--"));
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

/** Same shape factory.mjs generates (date-slug, may end in a hyphen); no dots or slashes, so no traversal. */
export const isTaskId = (id) => /^[a-z0-9][a-z0-9-]*$/.test(id ?? "");

/** True when this file is the script node was started with (robust to percent-encoded paths). */
export const isMainModule = (metaUrl, argv1) => !!argv1 && pathToFileURL(argv1).href === metaUrl;

/** Names captured on only one side: a missing screenshot must never pass as "unchanged". */
export function oneSided(before, after) {
  return [
    ...before.filter((name) => !after.includes(name)).map((name) => ({ name, side: "after" })),
    ...after.filter((name) => !before.includes(name)).map((name) => ({ name, side: "before" })),
  ];
}

function die(message) {
  console.error(`shots: ${message}`);
  process.exit(1);
}
const shots = config.shots;
// An argument array, never a shell string: --base and the task id are user input.
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); // prettier-ignore
const base = flag("base") ?? `origin/${config.baseBranch ?? "main"}`;

/** A free port, so a stale dev server is never silently reused for the wrong tree. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The sandbox's preinstalled Chromium when the project's Playwright wants another revision. */
function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const dir = "/opt/pw-browsers";
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs
    .readdirSync(dir)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()) {
    // prettier-ignore
    for (const sub of ["chrome-linux64", "chrome-linux"]) {
      const candidate = path.join(dir, entry, sub, "chrome");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function capture(label, cwd, outDir) {
  const port = await freePort();
  console.log(`▶ ${label}: capturing in ${cwd} on :${port}`);
  const result = spawnSync(
    "bunx",
    ["playwright", "test", shots.spec, `--project=${shots.project ?? "desktop"}`, "--reporter=list", "--workers=1"], // prettier-ignore
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_PORT: String(port),
        FACTORY_SHOTS: label,
        FACTORY_SHOT_DIR: outDir,
        FACTORY_SHOT_SCENES: flag("scenes") ?? "",
        PLAYWRIGHT_CHROMIUM_PATH: chromiumPath() ?? "",
      },
    },
  );
  // Throw rather than die(): process.exit would skip the worktree cleanup in main.
  if (result.status !== 0) throw new Error(`${label} capture failed (exit ${result.status})`);
}

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG (what Chromium writes). Zero dependencies. */
export function decodePng(buf) {
  let at = 8;
  let header = null;
  const idat = [];
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] }; // prettier-ignore
    if (type === "IDAT") idat.push(body);
    at += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace !== 0 || ![2, 6].includes(header.color))
    throw new Error("unsupported PNG (need 8-bit RGB/RGBA, non-interlaced)");
  const channels = header.color === 6 ? 4 : 3;
  const stride = header.width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * header.height);
  for (let row = 0; row < header.height; row++) {
    const filter = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[row * (stride + 1) + 1 + i];
      const left = i >= channels ? out[row * stride + i - channels] : 0;
      const up = row ? out[(row - 1) * stride + i] : 0;
      const upLeft = row && i >= channels ? out[(row - 1) * stride + i - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - upLeft;
        const dLeft = Math.abs(guess - left);
        const dUp = Math.abs(guess - up);
        const dUpLeft = Math.abs(guess - upLeft);
        predictor = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      out[row * stride + i] = (value + predictor) & 255;
    }
  }
  return { width: header.width, height: header.height, channels, data: out };
}

// Summed RGB delta at or below this is rendering noise, not a change: gradients and
// glows dither by a level or two between identical renders (measured: max 3 on an
// untouched sealed pack). A real tint, shadow or opacity tweak moves colours by far more.
const NOISE_FLOOR = 6;

/**
 * How different two screenshots are. `ratio` is the share of pixels that moved a
 * lot; `faintRatio` the share that moved only a little (a tint, a shadow, an
 * opacity tweak). Anything above zero in either is a change: "identical" must mean
 * identical, or a faint real change hides under the control's label.
 */
export function pixelDiff(bufferA, bufferB) {
  const a = decodePng(bufferA);
  const b = decodePng(bufferB);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels)
    return { sizeDiffers: true, ratio: 1, faintRatio: 0 };
  let strong = 0;
  let faint = 0;
  for (let px = 0; px < a.width * a.height; px++) {
    let delta = 0;
    for (let c = 0; c < Math.min(a.channels, 3); c++)
      delta += Math.abs(a.data[px * a.channels + c] - b.data[px * b.channels + c]);
    if (delta > 40) strong++;
    else if (delta > NOISE_FLOOR) faint++;
  }
  const total = a.width * a.height;
  return { sizeDiffers: false, ratio: strong / total, faintRatio: faint / total };
}

/** Table cell for a pair's verdict. */
function verdict(diff) {
  if (!diff) return "identical";
  if (diff.sizeDiffers) return "**changed** (page height differs)";
  if (diff.ratio > 0) return `**changed ${(diff.ratio * 100).toFixed(2)}%**`;
  return `**faint colour shift** (${(diff.faintRatio * 100).toFixed(2)}% of pixels, small tint/shadow/opacity change)`;
}

export function compareMarkdown(taskId, before, after, fontWarnings, changed = new Map()) {
  const names = [...new Set([...before, ...after])].sort(
    // Pairs that actually differ first: identical pairs are not evidence of anything.
    (a, b) => Number(changed.has(b)) - Number(changed.has(a)) || a.localeCompare(b),
  );
  const cell = (set, side, name) =>
    set.includes(name) ? `![${side} ${name}](${side}/${name})` : "_not captured_";
  const verdictFor = (name) =>
    !before.includes(name)
      ? "**missing before**"
      : !after.includes(name)
        ? "**missing after**"
        : verdict(changed.get(name));
  const rows = names.map(
    (name) =>
      `| \`${name}\` | ${verdictFor(name)} | ${cell(before, "before", name)} | ${cell(after, "after", name)} |`,
  );
  return [
    `# Before / after — ${taskId}`,
    "",
    ...(fontWarnings.length
      ? [
          `> **Typeface caveat:** the real display font (Barlow Condensed) did not load for: ${fontWarnings.join(", ")}.`,
          "> The sandbox fell back to a system face, which is narrower, so widths and wrapping here",
          "> are approximate. Treat these as layout evidence, not pixel-exact.",
          "",
        ]
      : []),
    '> Captured against stubbed data (no live backend). The "Live feed down" banner, an artifact of the',
    "> capture's deliberately dead backend that appears at random moments, is hidden in both sets.",
    "",
    "| Capture | Pixels | Before | After |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

if (isMainModule(import.meta.url, process.argv[1])) {
  // Checked here, not at import time, so the pure helpers above can be unit-tested.
  if (!taskId) die("usage: shots.mjs <task-id> [--scenes a,b] [--base <ref>]");
  if (!shots?.spec) die('.factory/project.json has no "shots": { "spec": "<path>" }');
  if (base.startsWith("-")) die(`base ref "${base}" must not start with a hyphen`);
  if (!isTaskId(taskId)) die(`task id "${taskId}" must be lowercase letters, digits and hyphens`);
  if (!fs.existsSync(path.join(root, ".factory/tasks", `${taskId}.json`)))
    die(`no task record .factory/tasks/${taskId}.json`);
  try {
    git("rev-parse", "--verify", "-q", base);
  } catch {
    die(`base ref ${base} not found (git fetch origin ${config.baseBranch ?? "main"})`);
  }
  const shotsDir = path.join(root, ".factory/evidence", taskId, "shots");
  // A --scenes run refreshes just those scenes; --no-capture only re-compares what is
  // already on disk. Both keep the existing files.
  const recompareOnly = args.includes("--no-capture");
  if (!flag("scenes") && !recompareOnly) fs.rmSync(shotsDir, { recursive: true, force: true });
  fs.mkdirSync(shotsDir, { recursive: true });

  if (!recompareOnly) {
    const worktree = path.join(root, `.factory/tmp-shots-${process.pid}`);
    // A run killed mid-way (Ctrl-C, a dead session) leaves its worktree behind; sweep those.
    for (const entry of fs.readdirSync(path.join(root, ".factory")))
      if (entry.startsWith("tmp-shots-")) fs.rmSync(path.join(root, ".factory", entry), { recursive: true, force: true }); // prettier-ignore
    try {
      git("worktree", "prune");
    } catch {
      // Nothing to prune is fine.
    }
    let failure = null;
    try {
      git("worktree", "add", "--detach", worktree, base);
      // Same dependencies for both trees; a second install would be slow and could drift.
      fs.symlinkSync(path.join(root, "node_modules"), path.join(worktree, "node_modules"), "dir");
      // The spec does not exist at the base commit; bring it (and nothing else) along.
      fs.copyFileSync(path.join(root, shots.spec), path.join(worktree, shots.spec));
      await capture("before", worktree, shotsDir);
    } catch (error) {
      failure = error;
    } finally {
      fs.rmSync(path.join(worktree, "node_modules"), { force: true });
      try {
        git("worktree", "remove", "--force", worktree);
      } catch {
        fs.rmSync(worktree, { recursive: true, force: true });
        git("worktree", "prune");
      }
    }
    if (failure) die(failure.message);
    try {
      await capture("after", root, shotsDir);
    } catch (error) {
      die(error.message);
    }
  }

  const list = (label) => fs.readdirSync(path.join(shotsDir, label)).filter((f) => f.endsWith(".png")).sort(); // prettier-ignore
  const fontWarnings = [];
  for (const label of ["before", "after"]) {
    const meta = JSON.parse(fs.readFileSync(path.join(shotsDir, label, "meta.json"), "utf8"));
    for (const [key, value] of Object.entries(meta)) if (!value.fontOk) fontWarnings.push(`${label}:${key}`); // prettier-ignore
  }
  const changed = new Map();
  for (const name of list("after").filter((file) => list("before").includes(file))) {
    const diff = pixelDiff(
      fs.readFileSync(path.join(shotsDir, "before", name)),
      fs.readFileSync(path.join(shotsDir, "after", name)),
    );
    if (diff.sizeDiffers || diff.ratio > 0 || diff.faintRatio > 0) changed.set(name, diff);
  }
  fs.writeFileSync(
    path.join(shotsDir, "compare.md"),
    compareMarkdown(taskId, list("before"), list("after"), [...new Set(fontWarnings)], changed),
  );
  console.log(
    `${changed.size} of ${list("after").length} captures differ between before and after`,
  );

  // The raw set is large and stays local (gitignored). What gets committed for a
  // reviewer is the part that is evidence: every changed phone-width viewport shot,
  // plus one unchanged shot as a control showing nothing else moved.
  // Viewport shots at phone widths, plus the full-page shot at the short phone: tall
  // screens (a shop, a long list) keep their evidence below the fold.
  const phoneShot = (name) =>
    (/-(320|390|430|320x568)\.png$/.test(name) && !name.endsWith("-full.png")) ||
    name.endsWith("-320x568-full.png");
  // Both sides must have the file, or the copy below would throw and a one-sided
  // shot would pose as an unchanged control.
  const both = list("after").filter((name) => list("before").includes(name));
  const reviewNames = both.filter((name) => phoneShot(name) && changed.has(name));
  const control = both.find((name) => phoneShot(name) && !changed.has(name));
  if (control) reviewNames.push(control);
  const reviewDir = path.join(shotsDir, "review");
  fs.rmSync(reviewDir, { recursive: true, force: true });
  for (const label of ["before", "after"]) {
    fs.mkdirSync(path.join(reviewDir, label), { recursive: true });
    for (const name of reviewNames)
      fs.copyFileSync(path.join(shotsDir, label, name), path.join(reviewDir, label, name));
  }
  fs.writeFileSync(
    path.join(reviewDir, "compare.md"),
    compareMarkdown(taskId, reviewNames, reviewNames, [...new Set(fontWarnings)], changed),
  );
  console.log(
    `Review set (commit this): ${path.relative(root, reviewDir)}/ — ${reviewNames.length} pairs`,
  );
  console.log(
    `\nShots written to ${path.relative(root, shotsDir)}/ (compare.md has the side-by-side)`,
  );
  if (fontWarnings.length)
    console.log("⚠ the real display font did not load; widths are approximate");
  // A --scenes run legitimately leaves other scenes' files from earlier runs, so only a full run is judged.
  const lopsided = oneSided(list("before"), list("after"));
  if (lopsided.length && !flag("scenes")) {
    for (const { name, side } of lopsided) console.error(`shots: ${name} is missing ${side}`);
    die(`${lopsided.length} capture(s) exist on one side only; this is not proof of "unchanged"`);
  }
}
