// Run: node --test .claude/factory/factory.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, selectGates } from "./factory.mjs";
import { decide } from "../hooks/factory-guard.mjs";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { compareMarkdown, isMainModule, isTaskId, oneSided, pixelDiff } from "./shots.mjs";

const CLI = path.resolve(import.meta.dirname, "factory.mjs");

function repo(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, ".factory"));
  fs.writeFileSync(
    path.join(dir, ".factory/project.json"),
    JSON.stringify({
      baseBranch: "main",
      maxActiveTasks: 1,
      maxRepairAttempts: 3,
      gates: [
        { name: "ok", cmd: "true" },
        { name: "docs", cmd: "true", paths: ["^docs/"] },
      ],
      ...extra,
    }),
  );
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  git("add", ".");
  git("commit", "-qm", "init");
  const run = (...args) => spawnSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8" });
  run.dir = dir;
  return { dir, git, run };
}

// A task that has passed a full gate run and an approving review.
function approvedTask(options) {
  const fixture = repo(options);
  const id = fixture.run("new", "task").stdout.trim();
  assert.equal(fixture.run("gates", id).status, 0);
  fixture.run("set", id, "--review", "approve", "--reviewer", "reviewer");
  return { ...fixture, id };
}
const commitAll = (fixture, message) => {
  fixture.git("add", ".");
  fixture.git("commit", "-qm", message);
};

test("parseArgs collects repeated flags and booleans", () => {
  const opts = parseArgs(["title", "words", "--accept", "a", "--accept", "b", "--force"]);
  assert.deepEqual(opts._, ["title", "words"]);
  assert.deepEqual(opts.accept, ["a", "b"]);
  assert.equal(opts.force, true);
});

test("selectGates filters by changed paths", () => {
  const gates = [{ name: "a" }, { name: "db", paths: ["^supabase/"] }];
  assert.deepEqual(
    selectGates(gates, ["src/x.ts"]).map((gate) => gate.name),
    ["a"],
  );
  assert.deepEqual(
    selectGates(gates, ["supabase/m.sql"]).map((gate) => gate.name),
    ["a", "db"],
  );
});

test("an unstaged edit to the first changed file still selects its gates", () => {
  // git status --porcelain starts with " M path"; trimming it used to corrupt the
  // first filename so path-scoped gates silently did not run.
  const fixture = repo({
    gates: [
      { name: "ok", cmd: "true" },
      { name: "db", cmd: "true", paths: ["^supabase/"] },
    ],
  });
  fs.mkdirSync(path.join(fixture.dir, "supabase"));
  fs.writeFileSync(path.join(fixture.dir, "supabase/m.sql"), "-- v1");
  commitAll(fixture, "add migration");
  fs.writeFileSync(path.join(fixture.dir, "supabase/m.sql"), "-- v2");
  assert.match(fixture.run("gates").stdout, /▶ db/u);
});

test("concurrency ceiling refuses a second active task", () => {
  const { run } = repo();
  assert.equal(run("new", "first").status, 0);
  const second = run("new", "second");
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /concurrency ceiling/u);
});

test("cannot mark ready without passing gates and a review", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  assert.match(run("set", id, "--status", "ready").stderr, /gate run missing/u);
  assert.equal(run("gates", id).status, 0);
  assert.match(run("set", id, "--status", "ready").stderr, /no recorded independent review/u);
  run("set", id, "--review", "changes", "--reviewer", "reviewer");
  assert.match(run("set", id, "--status", "ready").stderr, /not approve/u);
  run("set", id, "--review", "approve", "--reviewer", "reviewer");
  assert.equal(run("set", id, "--status", "ready").status, 0);
});

test("a failing gate fails the run and blocks ready", () => {
  const { run } = repo({ gates: [{ name: "bad", cmd: "echo boom; exit 3" }] });
  const id = run("new", "t").stdout.trim();
  const result = run("gates", id);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /boom/u);
  assert.match(run("set", id, "--status", "ready").stderr, /failed/u);
});

test("a passing partial rerun cannot unlock ready after a failed full run", () => {
  const fixture = repo({
    gates: [
      { name: "needs-flag", cmd: "test -f flag" },
      { name: "fine", cmd: "true" },
    ],
  });
  const id = fixture.run("new", "t").stdout.trim();
  assert.equal(fixture.run("gates", id).status, 1);
  assert.equal(fixture.run("gates", id, "--only", "fine").status, 0);
  fixture.run("set", id, "--review", "approve", "--reviewer", "reviewer");
  assert.match(fixture.run("set", id, "--status", "ready").stderr, /partial/u);
});

test("stale gates (code committed after the run) block ready", () => {
  const fixture = approvedTask();
  fs.writeFileSync(path.join(fixture.dir, "b.txt"), "y");
  commitAll(fixture, "more");
  assert.match(
    fixture.run("set", fixture.id, "--status", "ready").stderr,
    /code changed since the last passing gate run/u,
  );
});

test("an uncommitted edit after the gates ran blocks ready", () => {
  const fixture = approvedTask();
  fs.writeFileSync(path.join(fixture.dir, "a.txt"), "edited after gates");
  assert.match(
    fixture.run("set", fixture.id, "--status", "ready").stderr,
    /code changed since the last passing gate run/u,
  );
});

test("a gate-policy change in project.json after the run blocks ready", () => {
  const fixture = approvedTask();
  fs.writeFileSync(
    path.join(fixture.dir, ".factory/project.json"),
    JSON.stringify({ baseBranch: "main", maxActiveTasks: 1, maxRepairAttempts: 3, gates: [] }),
  );
  assert.match(
    fixture.run("set", fixture.id, "--status", "ready").stderr,
    /code changed since the last passing gate run/u,
  );
});

test("an empty gate selection does not count as a pass", () => {
  const { run } = repo({ gates: [] });
  const id = run("new", "t").stdout.trim();
  const result = run("gates", id);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no gates were selected/u);
});

test("committing only .factory/ files does not make gates stale", () => {
  const fixture = approvedTask();
  commitAll(fixture, "record");
  assert.equal(fixture.run("set", fixture.id, "--status", "ready").status, 0);
});

test("approval does not survive a code change even after the gates are re-run", () => {
  const fixture = approvedTask();
  fs.writeFileSync(path.join(fixture.dir, "b.txt"), "y");
  commitAll(fixture, "post-review change");
  assert.equal(fixture.run("gates", fixture.id).status, 0);
  assert.match(
    fixture.run("set", fixture.id, "--status", "ready").stderr,
    /code changed since the review/u,
  );
});

test("gates do not clobber a record written while they ran", () => {
  const { run } = repo({ gates: [{ name: "slow", cmd: "sleep 1" }] });
  const id = run("new", "t").stdout.trim();
  const child = spawn("node", [CLI, "gates", id], { cwd: run.dir, stdio: "ignore" });
  return new Promise((resolve) => {
    setTimeout(() => {
      run("set", id, "--review", "approve", "--reviewer", "reviewer");
      child.on("exit", () => {
        const record = JSON.parse(
          fs.readFileSync(path.join(run.dir, ".factory/tasks", `${id}.json`), "utf8"),
        );
        assert.equal(record.review?.verdict, "approve");
        assert.equal(record.gateRuns.length, 1);
        resolve();
      });
    }, 300);
  });
});

test("repair budget blocks the task after 3 failed attempts", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  for (let attempt = 1; attempt <= 3; attempt++)
    assert.equal(
      run("repair", id, "--issue", "x", "--result", "failed", "--note", `try ${attempt}`).status,
      0,
    );
  const fourth = run("repair", id, "--issue", "x", "--result", "failed", "--note", "try 4");
  assert.notEqual(fourth.status, 0);
  assert.match(fourth.stderr, /budget spent/u);
  assert.match(run("status").stdout, /\[blocked\]/u);
});

test("identical repeated failure blocks early", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  run("repair", id, "--issue", "x", "--result", "failed", "--note", "same");
  assert.match(
    run("repair", id, "--issue", "x", "--result", "failed", "--note", "same").stderr,
    /recurred identically/u,
  );
});

test("status flags a task whose branch does not exist", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  run("set", id, "--branch", "factory/ghost", "--status", "building");
  assert.match(run("status").stdout, /branch factory\/ghost not found/u);
});

test("guard blocks protected paths and dangerous commands only", () => {
  const config = {
    protectedPaths: ["^src/integrations/supabase/"],
    blockedBashPatterns: [
      "git\\s+push\\b[^;&|]*[\\s:](main|master)(\\s|$)",
      "git\\s+push\\b.*--force",
    ],
  };
  const write = (file) =>
    decide({ tool_name: "Write", tool_input: { file_path: file } }, config, "/r");
  const bash = (command) => decide({ tool_name: "Bash", tool_input: { command } }, config, "/r");
  assert.ok(write("/r/src/integrations/supabase/types.ts"));
  assert.ok(write("/r/src/../src/integrations/supabase/x.ts"));
  assert.equal(write("/r/src/lib/a.ts"), null);
  assert.ok(bash("git push origin main"));
  assert.ok(bash("git push --force origin f"));
  assert.equal(bash("git push -u origin claude/main-menu"), null);
  assert.equal(bash("cat > f <<'EOF'\ngit push --force origin main\nEOF"), null);
});

// A tiny RGBA PNG with one filter-0 scanline per row, so the diff can be tested without a browser.
function png(width, height, pixel, filter = 0) {
  const crc = (buf) => {
    let value = ~0;
    for (const byte of buf) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return ~value >>> 0;
  };
  const chunk = (type, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([head, Buffer.from(type), body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([filter]));
    for (let x = 0; x < width; x++) {
      const now = pixel(x, y);
      // Sub (1) stores the difference from the pixel to the left, Up (2) from the one above.
      let reference = [0, 0, 0, 0];
      if (filter === 1 && x) reference = pixel(x - 1, y);
      if (filter === 2 && y) reference = pixel(x, y - 1);
      rows.push(Buffer.from(now.map((value, i) => (value - reference[i]) & 255)));
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("pixelDiff: identical, partly different, and different sizes", () => {
  const grey = () => [90, 90, 90, 255];
  assert.equal(pixelDiff(png(4, 4, grey), png(4, 4, grey)).ratio, 0);
  const oneBright = (x, y) => (x === 0 && y === 0 ? [255, 255, 255, 255] : grey());
  assert.equal(pixelDiff(png(4, 4, grey), png(4, 4, oneBright)).ratio, 1 / 16);
  // A faint shift (a tint or shadow tweak) is a change too, just not a strong one: it
  // must never read as "identical", or a real faint edit hides under the control's label.
  const faint = pixelDiff(
    png(2, 2, grey),
    png(2, 2, () => [100, 90, 90, 255]),
  );
  assert.equal(faint.ratio, 0);
  assert.equal(faint.faintRatio, 1);
  // Dithering-level noise (a few levels) is not a change at all.
  const noise = pixelDiff(
    png(2, 2, grey),
    png(2, 2, () => [92, 91, 90, 255]),
  );
  assert.deepEqual([noise.ratio, noise.faintRatio], [0, 0]);
  assert.equal(pixelDiff(png(2, 2, grey), png(3, 2, grey)).sizeDiffers, true);
});

test("decodePng reads Sub- and Up-filtered scanlines the way Chromium writes them", () => {
  const gradient = (x, y) => [x * 40, y * 30, 7, 255];
  for (const filter of [1, 2]) {
    const diff = pixelDiff(png(5, 5, gradient, 0), png(5, 5, gradient, filter));
    assert.deepEqual([diff.ratio, diff.faintRatio], [0, 0], `filter ${filter}`);
  }
});

test("shots: task ids are slug-shaped, so they cannot traverse out of the evidence dir", () => {
  assert.ok(isTaskId("2026-11-08-shop-group-duplicate-secrets-by-name-in-"));
  for (const bad of ["../x", "a/b", "A", "", undefined, "..", ".hidden", "a b"])
    assert.equal(isTaskId(bad), false, String(bad));
});

test("shots: the main-module check survives percent-encoded paths", () => {
  const file = path.join(os.tmpdir(), "a b%20c", "shots.mjs");
  assert.ok(isMainModule(pathToFileURL(file).href, file));
  assert.equal(isMainModule(pathToFileURL(file).href, "/other.mjs"), false);
  assert.equal(isMainModule(pathToFileURL(file).href), false);
});

test("shots: a capture on one side only is reported, never 'identical'", () => {
  assert.deepEqual(oneSided(["a.png", "b.png"], ["a.png", "c.png"]), [
    { name: "b.png", side: "after" },
    { name: "c.png", side: "before" },
  ]);
  const md = compareMarkdown("t", ["a.png", "b.png"], ["a.png", "c.png"], []);
  assert.match(md, /`b\.png` \| \*\*missing after\*\*/);
  assert.match(md, /`c\.png` \| \*\*missing before\*\*/);
  assert.match(md, /`a\.png` \| identical/);
});
