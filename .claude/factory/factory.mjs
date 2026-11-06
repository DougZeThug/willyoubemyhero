#!/usr/bin/env node
// Factory state + gate runner. Zero dependencies so it installs into any repo.
// Task records live in .factory/tasks/*.json and are the durable memory; status
// re-derives truth from git rather than trusting what a record says.
// process.exit is deliberate throughout: this is a CLI whose exit code is its API.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const dir = path.join(root, ".factory");
const tasksDir = path.join(dir, "tasks");
const STATUSES = ["planned", "building", "verifying", "reviewing", "ready", "blocked", "done"];
const ACTIVE = ["planned", "building", "verifying", "reviewing"];
const STATUS_ORDER = ["building", "verifying", "reviewing", "planned", "blocked", "ready", "done"];

const sh = (cmd) => {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const cfg = () =>
  readJson(path.join(dir, "project.json"), {
    baseBranch: "main",
    maxActiveTasks: 1,
    maxRepairAttempts: 3,
    gates: [],
  });
const taskPath = (id) => path.join(tasksDir, `${id}.json`);
const load = (id) => {
  const task = readJson(taskPath(id));
  if (!task) die(`no such task: ${id}`);
  return task;
};
const save = (task) => {
  task.updatedAt = new Date().toISOString();
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(taskPath(task.id), `${JSON.stringify(task, null, 2)}\n`);
};
const all = () =>
  (fs.existsSync(tasksDir)
    ? fs
        .readdirSync(tasksDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => readJson(path.join(tasksDir, name)))
    : []
  ).filter(Boolean);
function die(message) {
  console.error(`factory: ${message}`);
  process.exit(1);
}
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) opts[key] = true;
    else {
      opts[key] = [...(Array.isArray(opts[key]) ? opts[key] : []), value];
      i++;
    }
  }
  return opts;
}
const one = (value) => (Array.isArray(value) ? value[value.length - 1] : value);

export function selectGates(gates, changed) {
  return gates.filter(
    (gate) =>
      !gate.paths || changed.some((file) => gate.paths.some((p) => new RegExp(p).test(file))),
  );
}
export function changedFiles(base) {
  // Plain name lists, not `status --porcelain`: sh() trims the output, which eats
  // the leading space of the first " M path" entry and corrupts its filename.
  const lists = [
    sh(`git diff --name-only ${base}...HEAD`),
    sh("git diff --name-only HEAD"),
    sh("git ls-files --others --exclude-standard"),
  ];
  return [...new Set(lists.flatMap((list) => (list ?? "").split("\n")))].filter(Boolean);
}

// Content hash of the working tree outside .factory/, independent of commits.
// Task records and evidence cannot change behaviour, so committing them must not
// invalidate a passing gate run or review; but an uncommitted edit after the
// gates ran must. Built in a throwaway index so the real one is never touched.
export function contentFingerprint() {
  const index = path.join(os.tmpdir(), `factory-idx-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    execSync("git add -A -- . ':(exclude).factory'", { cwd: root, env, stdio: "ignore" });
    return execSync("git write-tree", { cwd: root, env, encoding: "utf8" }).trim();
  } catch {
    return null;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

// Everything that must hold before a task may be called ready/done.
function assertCanComplete(task, target, force) {
  const last = task.gateRuns.at(-1);
  if (!last || !last.passed)
    die(
      `cannot mark ${target}: latest gate run ${last ? "failed" : "missing"}. Run: factory gates ${task.id}`,
    );
  // A subset rerun (--only) proves less than the full selection, so it can never
  // be the run that unlocks completion.
  if (last.partial)
    die(
      `cannot mark ${target}: latest gate run was partial (--only). Run: factory gates ${task.id}`,
    );
  const current = contentFingerprint();
  if ((!current || last.fp !== current) && !force)
    die(`cannot mark ${target}: code changed since the last passing gate run. Re-run gates.`);
  if (task.kind !== "maintain" && !task.review)
    die(
      `cannot mark ${target}: no recorded independent review (factory set ${task.id} --review approve|changes --reviewer <agent>)`,
    );
  if (task.review && task.review.verdict !== "approve")
    die(`cannot mark ${target}: review verdict is not approve`);
  if (task.review && task.review.fp !== current && !force)
    die(`cannot mark ${target}: code changed since the review. Get a fresh independent review.`);
}

function resolveBranch(task) {
  if (!task.branch) return null;
  if (sh(`git rev-parse --verify -q ${task.branch}`)) return task.branch;
  if (sh(`git rev-parse --verify -q origin/${task.branch}`)) return `origin/${task.branch}`;
  return null;
}

// Cross-checks a record against git; returns human-readable contradictions.
function warningsFor(task, config, ctx) {
  const warn = [];
  const branchRef = resolveBranch(task);
  const last = task.gateRuns.at(-1);
  if (["building", "verifying", "reviewing", "ready", "done"].includes(task.status)) {
    if (!task.branch) warn.push("no branch recorded");
    else if (!branchRef) warn.push(`branch ${task.branch} not found`);
    else if (
      task.status !== "done" &&
      (sh(`git rev-list --count ${config.baseBranch}..${branchRef}`) ?? "0") === "0" &&
      !sh(`git rev-parse --verify -q origin/${config.baseBranch}`)
    )
      warn.push("no commits beyond base");
  }
  if (["ready", "done"].includes(task.status) && (!last || !last.passed))
    warn.push("marked complete without a passing gate run");
  // Only the checked-out branch can be compared: the fingerprint hashes the working tree.
  if (
    last &&
    branchRef === ctx.currentBranch &&
    last.fp !== ctx.fingerprint &&
    ["ready", "reviewing"].includes(task.status)
  )
    warn.push("gates are stale (code changed since they ran)");
  return warn;
}

function describeTask(task, warn) {
  const last = task.gateRuns.at(-1);
  const gateSummary = last ? `${last.passed ? "pass" : "FAIL"} ${last.gates.join(" ")}` : "none";
  const pr = task.pr ? ` · PR ${task.pr}` : "";
  console.log(`[${task.status}] ${task.id} — ${task.title}`);
  console.log(
    `    gates: ${gateSummary} · repairs ${task.repairs.length} · interventions ${task.interventions}${pr}`,
  );
  console.log(`    next: ${task.nextAction}`);
  for (const message of warn) console.log(`    ⚠ ${message}`);
}

const commands = {
  new(opts) {
    const title = opts._.join(" ").trim();
    if (!title)
      die('usage: new "<title>" [--kind build|fix|polish|maintain] [--accept "criterion" ...]');
    const config = cfg();
    const active = all().filter((task) => ACTIVE.includes(task.status));
    if (active.length >= config.maxActiveTasks && !opts.force)
      die(
        `concurrency ceiling reached (${active.length}/${config.maxActiveTasks}): ${active.map((task) => task.id).join(", ")}. Finish or block one first.`,
      );
    const id = `${new Date().toISOString().slice(0, 10)}-${slug(title)}`;
    if (fs.existsSync(taskPath(id))) die(`task exists: ${id}`);
    const accept = [].concat(opts.accept === true || !opts.accept ? [] : opts.accept);
    save({
      id,
      title,
      kind: one(opts.kind) || "build",
      status: "planned",
      branch: one(opts.branch) || null,
      createdAt: new Date().toISOString(),
      acceptance: accept,
      repairs: [],
      gateRuns: [],
      interventions: 0,
      nextAction: "plan",
      notes: [],
    });
    console.log(id);
  },
  set(opts) {
    const task = load(opts._[0]);
    if (opts.status) {
      const target = one(opts.status);
      if (!STATUSES.includes(target)) die(`status must be one of ${STATUSES}`);
      if (target === "ready" || target === "done") assertCanComplete(task, target, opts.force);
      task.status = target;
    }
    if (opts.branch) task.branch = one(opts.branch);
    if (opts.next) task.nextAction = one(opts.next);
    if (opts.note) task.notes.push({ at: new Date().toISOString(), text: one(opts.note) });
    if (opts.intervention) task.interventions += 1;
    if (opts.accept) task.acceptance.push(...[].concat(opts.accept));
    if (opts.review)
      task.review = {
        verdict: one(opts.review),
        reviewer: one(opts.reviewer) || "unknown",
        head: sh("git rev-parse HEAD"),
        fp: contentFingerprint(),
        at: new Date().toISOString(),
      };
    if (opts.pr) task.pr = one(opts.pr);
    save(task);
    console.log(`${task.id}: ${task.status}`);
  },
  repair(opts) {
    const task = load(opts._[0]);
    const config = cfg();
    const issue = one(opts.issue);
    if (!issue) die("usage: repair <id> --issue <key> --result fixed|failed [--note ...]");
    const prior = task.repairs.filter((attempt) => attempt.issue === issue);
    if (prior.length >= config.maxRepairAttempts) {
      task.status = "blocked";
      task.nextAction = `escalate: ${issue} failed ${prior.length} repairs`;
      save(task);
      die(
        `repair budget spent for "${issue}" (${prior.length}/${config.maxRepairAttempts}); task blocked — escalate to the user`,
      );
    }
    const result = one(opts.result) || "failed";
    if (result === "failed" && prior.at(-1)?.note && prior.at(-1).note === one(opts.note)) {
      task.status = "blocked";
      save(task);
      die("same failure recurred identically; task blocked — change approach or escalate");
    }
    task.repairs.push({
      issue,
      attempt: prior.length + 1,
      result,
      note: one(opts.note) || "",
      at: new Date().toISOString(),
    });
    save(task);
    console.log(`repair ${prior.length + 1}/${config.maxRepairAttempts} for "${issue}": ${result}`);
  },
  gates(opts) {
    const id = opts._[0];
    const task = id ? load(id) : null;
    const config = cfg();
    const files = changedFiles(config.baseBranch);
    let selected = opts.all ? config.gates : selectGates(config.gates, files);
    if (opts.only)
      selected = config.gates.filter((gate) => [].concat(opts.only).includes(gate.name));
    const run = {
      at: new Date().toISOString(),
      head: sh("git rev-parse HEAD"),
      fp: contentFingerprint(),
      partial: Boolean(opts.only),
      results: [],
      passed: true,
    };
    const evidenceDir = path.join(dir, "evidence", task?.id ?? "adhoc");
    fs.mkdirSync(evidenceDir, { recursive: true });
    for (const gate of selected) {
      const started = Date.now();
      console.log(`▶ ${gate.name}: ${gate.cmd}`);
      const proc = spawnSync(gate.cmd, {
        cwd: root,
        shell: true,
        encoding: "utf8",
        maxBuffer: 1 << 28,
      });
      const output = (proc.stdout ?? "") + (proc.stderr ?? "");
      const tail = output.split("\n").slice(-40).join("\n");
      const ok = proc.status === 0;
      run.passed &&= ok;
      run.results.push({ gate: gate.name, ok, ms: Date.now() - started, tail: ok ? "" : tail });
      console.log(
        `${ok ? "✔" : "✘"} ${gate.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
      if (!ok) console.log(tail);
    }
    // Edits landing while the gates ran mean the result describes no single state.
    if (contentFingerprint() !== run.fp) {
      run.passed = false;
      console.log("✘ working tree changed while gates were running; result discarded");
    }
    run.skipped = config.gates.filter((gate) => !selected.includes(gate)).map((gate) => gate.name);
    run.deferredToCI = config.deferredToCI ?? [];
    fs.writeFileSync(
      path.join(evidenceDir, `gates-${run.at.replace(/[:.]/g, "-")}.json`),
      JSON.stringify(run, null, 2),
    );
    if (task) {
      // Re-read: gates run for minutes, and a review or note recorded meanwhile
      // would be overwritten by the copy loaded at the start.
      const fresh = load(task.id);
      fresh.gateRuns.push({
        at: run.at,
        head: run.head,
        fp: run.fp,
        partial: run.partial,
        passed: run.passed,
        gates: run.results.map((r) => `${r.gate}:${r.ok ? "pass" : "FAIL"}`),
        skipped: run.skipped,
      });
      save(fresh);
    }
    console.log(run.passed ? "GATES PASS" : "GATES FAIL");
    if (run.skipped.length) console.log(`skipped (not relevant to diff): ${run.skipped}`);
    if (run.deferredToCI.length) console.log(`deferred to CI: ${run.deferredToCI}`);
    process.exit(run.passed ? 0 : 1);
  },
  status() {
    const config = cfg();
    const tasks = all();
    if (!tasks.length) {
      console.log("No factory tasks. Start one with /factory-build.");
      return;
    }
    const ctx = {
      currentBranch: sh("git rev-parse --abbrev-ref HEAD"),
      fingerprint: contentFingerprint(),
    };
    const rows = tasks.map((task) => ({ task, warn: warningsFor(task, config, ctx) }));
    const active = rows.filter((row) => ACTIVE.includes(row.task.status));
    const head = sh("git rev-parse HEAD")?.slice(0, 7);
    console.log(
      `Factory: ${active.length}/${config.maxActiveTasks} active · ${tasks.length} total · HEAD ${head}\n`,
    );
    for (const status of STATUS_ORDER)
      for (const { task, warn } of rows.filter((row) => row.task.status === status))
        describeTask(task, warn);
  },
  metrics() {
    const tasks = all();
    const sum = (pick) => tasks.reduce((total, task) => total + pick(task), 0);
    const issuesWith = (task, result) =>
      new Set(task.repairs.filter((attempt) => attempt.result === result).map((a) => a.issue)).size;
    console.log(
      JSON.stringify(
        {
          tasks: tasks.length,
          done: tasks.filter((task) => ["ready", "done"].includes(task.status)).length,
          blocked: tasks.filter((task) => task.status === "blocked").length,
          interventions: sum((task) => task.interventions),
          repairAttempts: sum((task) => task.repairs.length),
          unresolvedRepairs: sum((task) => issuesWith(task, "failed") - issuesWith(task, "fixed")),
          gateRuns: sum((task) => task.gateRuns.length),
          gateRunsFailed: sum((task) => task.gateRuns.filter((run) => !run.passed).length),
        },
        null,
        2,
      ),
    );
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  if (!commands[command]) die(`usage: factory.mjs <${Object.keys(commands).join("|")}> ...`);
  commands[command](parseArgs(rest));
}
