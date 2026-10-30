// Run: node --test .claude/factory/
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "factory-"));
  const g = (...a) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.mkdirSync(path.join(d, ".factory"));
  fs.writeFileSync(
    path.join(d, ".factory/project.json"),
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
  fs.writeFileSync(path.join(d, "a.txt"), "x");
  g("add", ".");
  g("commit", "-qm", "init");
  const run = (...a) => spawnSync("node", [CLI, ...a], { cwd: d, encoding: "utf8" });
  run.d = d;
  return { d, g, run };
}

test("parseArgs collects repeated flags and booleans", () => {
  const o = parseArgs(["title", "words", "--accept", "a", "--accept", "b", "--force"]);
  assert.deepEqual(o._, ["title", "words"]);
  assert.deepEqual(o.accept, ["a", "b"]);
  assert.equal(o.force, true);
});

test("selectGates filters by changed paths", () => {
  const gates = [{ name: "a" }, { name: "db", paths: ["^supabase/"] }];
  assert.deepEqual(
    selectGates(gates, ["src/x.ts"]).map((g) => g.name),
    ["a"],
  );
  assert.deepEqual(
    selectGates(gates, ["supabase/m.sql"]).map((g) => g.name),
    ["a", "db"],
  );
});

test("concurrency ceiling refuses a second active task", () => {
  const { run } = repo();
  assert.equal(run("new", "first").status, 0);
  const r = run("new", "second");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /concurrency ceiling/);
});

test("cannot mark ready without passing gates and a review", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  assert.match(run("set", id, "--status", "ready").stderr, /gate run missing/);
  assert.equal(run("gates", id).status, 0);
  assert.match(run("set", id, "--status", "ready").stderr, /no recorded independent review/);
  run("set", id, "--review", "changes", "--reviewer", "r");
  assert.match(run("set", id, "--status", "ready").stderr, /not approve/);
  run("set", id, "--review", "approve", "--reviewer", "r");
  assert.equal(run("set", id, "--status", "ready").status, 0);
});

test("a failing gate fails the run and blocks ready", () => {
  const { run } = repo({ gates: [{ name: "bad", cmd: "echo boom; exit 3" }] });
  const id = run("new", "t").stdout.trim();
  const r = run("gates", id);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /boom/);
  assert.match(run("set", id, "--status", "ready").stderr, /failed/);
});

test("stale gates (HEAD moved) block ready", () => {
  const { run, d, g } = repo();
  const id = run("new", "t").stdout.trim();
  run("gates", id);
  run("set", id, "--review", "approve", "--reviewer", "r");
  fs.writeFileSync(path.join(d, "b.txt"), "y");
  g("add", ".");
  g("commit", "-qm", "more");
  assert.match(run("set", id, "--status", "ready").stderr, /HEAD moved/);
});

test("committing only .factory/ files does not make gates stale", () => {
  const { run, d, g } = repo();
  const id = run("new", "t").stdout.trim();
  run("gates", id);
  run("set", id, "--review", "approve", "--reviewer", "r");
  g("add", ".");
  g("commit", "-qm", "record");
  assert.equal(run("set", id, "--status", "ready").status, 0);
});

test("gates do not clobber a record written while they ran", () => {
  const { run } = repo({ gates: [{ name: "slow", cmd: "sleep 1" }] });
  const id = run("new", "t").stdout.trim();
  const p = spawn("node", [CLI, "gates", id], { cwd: run.d, stdio: "ignore" });
  return new Promise((resolve) => {
    setTimeout(() => {
      run("set", id, "--review", "approve", "--reviewer", "r");
      p.on("exit", () => {
        const rec = JSON.parse(
          fs.readFileSync(path.join(run.d, ".factory/tasks", `${id}.json`), "utf8"),
        );
        assert.equal(rec.review?.verdict, "approve");
        assert.equal(rec.gateRuns.length, 1);
        resolve();
      });
    }, 300);
  });
});

test("repair budget blocks the task after 3 failed attempts", () => {
  const { run } = repo();
  const id = run("new", "t").stdout.trim();
  for (let i = 1; i <= 3; i++)
    assert.equal(
      run("repair", id, "--issue", "x", "--result", "failed", "--note", `try ${i}`).status,
      0,
    );
  const r = run("repair", id, "--issue", "x", "--result", "failed", "--note", "try 4");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /budget spent/);
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
  const cfg = {
    protectedPaths: ["^src/integrations/supabase/"],
    blockedBashPatterns: [
      "git\\s+push\\b[^;&|]*[\\s:](main|master)(\\s|$)",
      "git\\s+push\\b.*--force",
    ],
  };
  const w = (f) => decide({ tool_name: "Write", tool_input: { file_path: f } }, cfg, "/r");
  const b = (c) => decide({ tool_name: "Bash", tool_input: { command: c } }, cfg, "/r");
  assert.ok(w("/r/src/integrations/supabase/types.ts"));
  assert.ok(w("/r/src/../src/integrations/supabase/x.ts"));
  assert.equal(w("/r/src/lib/a.ts"), null);
  assert.ok(b("git push origin main"));
  assert.ok(b("git push --force origin f"));
  assert.equal(b("git push -u origin claude/main-menu"), null);
  assert.equal(b("cat > f <<'EOF'\ngit push --force origin main\nEOF"), null);
});
