// Run: node --test .claude/factory/factory.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, selectGates } from "./factory.mjs";
import { decide } from "../hooks/factory-guard.mjs";

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
  assert.match(fixture.run("gates").stdout, /▶ db/);
});

test("concurrency ceiling refuses a second active task", () => {
  const { run } = repo();
  assert.equal(run("new", "first").status, 0);
  const second = run("new", "second");
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /concurrency ceiling/);
});

test("cannot mark ready without passing gates and a review", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  assert.match(run("set", id, "--status", "ready").stderr, /gate run missing/);
  assert.equal(run("gates", id).status, 0);
  assert.match(run("set", id, "--status", "ready").stderr, /no recorded independent review/);
  run("set", id, "--review", "changes", "--reviewer", "reviewer");
  assert.match(run("set", id, "--status", "ready").stderr, /not approve/);
  run("set", id, "--review", "approve", "--reviewer", "reviewer");
  assert.equal(run("set", id, "--status", "ready").status, 0);
});

test("a failing gate fails the run and blocks ready", () => {
  const { run } = repo({ gates: [{ name: "bad", cmd: "echo boom; exit 3" }] });
  const id = run("new", "t").stdout.trim();
  const result = run("gates", id);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /boom/);
  assert.match(run("set", id, "--status", "ready").stderr, /failed/);
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
  assert.match(fixture.run("set", id, "--status", "ready").stderr, /partial/);
});

test("stale gates (code committed after the run) block ready", () => {
  const fixture = approvedTask();
  fs.writeFileSync(path.join(fixture.dir, "b.txt"), "y");
  commitAll(fixture, "more");
  assert.match(
    fixture.run("set", fixture.id, "--status", "ready").stderr,
    /code changed since the last passing gate run/,
  );
});

test("an uncommitted edit after the gates ran blocks ready", () => {
  const fixture = approvedTask();
  fs.writeFileSync(path.join(fixture.dir, "a.txt"), "edited after gates");
  assert.match(
    fixture.run("set", fixture.id, "--status", "ready").stderr,
    /code changed since the last passing gate run/,
  );
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
    /code changed since the review/,
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
  assert.match(fourth.stderr, /budget spent/);
  assert.match(run("status").stdout, /\[blocked\]/);
});

test("identical repeated failure blocks early", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  run("repair", id, "--issue", "x", "--result", "failed", "--note", "same");
  assert.match(
    run("repair", id, "--issue", "x", "--result", "failed", "--note", "same").stderr,
    /recurred identically/,
  );
});

test("status flags a task whose branch does not exist", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  run("set", id, "--branch", "factory/ghost", "--status", "building");
  assert.match(run("status").stdout, /branch factory\/ghost not found/);
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
