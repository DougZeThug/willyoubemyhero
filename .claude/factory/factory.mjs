#!/usr/bin/env node
// Factory state + gate runner. Zero dependencies so it installs into any repo.
// Task records live in .factory/tasks/*.json and are the durable memory; status
// re-derives truth from git rather than trusting what a record says.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const dir = path.join(root, ".factory");
const tasksDir = path.join(dir, "tasks");
const STATUSES = ["planned", "building", "verifying", "reviewing", "ready", "blocked", "done"];
const ACTIVE = ["planned", "building", "verifying", "reviewing"];

const sh = (c) => {
  try {
    return execSync(c, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const readJson = (p, d) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return d;
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
  const t = readJson(taskPath(id));
  if (!t) die(`no such task: ${id}`);
  return t;
};
const save = (t) => {
  t.updatedAt = new Date().toISOString();
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(taskPath(t.id), JSON.stringify(t, null, 2) + "\n");
};
const all = () =>
  (fs.existsSync(tasksDir)
    ? fs
        .readdirSync(tasksDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJson(path.join(tasksDir, f)))
    : []
  ).filter(Boolean);
function die(m) {
  console.error(`factory: ${m}`);
  process.exit(1);
}
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) o[k] = true;
      else {
        o[k] = [...(Array.isArray(o[k]) ? o[k] : []), n];
        i++;
      }
    } else o._.push(a);
  }
  return o;
}
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

export function selectGates(gates, changed) {
  return gates.filter(
    (g) => !g.paths || changed.some((f) => g.paths.some((p) => new RegExp(p).test(f))),
  );
}
export function changedFiles(base) {
  const committed = sh(`git diff --name-only ${base}...HEAD`) ?? "";
  const dirty = sh("git status --porcelain") ?? "";
  return [
    ...new Set([...committed.split("\n"), ...dirty.split("\n").map((l) => l.slice(3))]),
  ].filter(Boolean);
}

// Task records and evidence live under .factory/ and cannot change behaviour,
// so committing them must not invalidate a passing gate run.
export function codeChangedSince(gateHead, ref) {
  const out = sh(`git diff --name-only ${gateHead} ${ref} -- . ':(exclude).factory'`);
  return out === null ? true : out !== "";
}

const commands = {
  new(o) {
    const title = o._.join(" ").trim();
    if (!title)
      die('usage: new "<title>" [--kind build|fix|polish|maintain] [--accept "criterion" ...]');
    const c = cfg();
    const active = all().filter((t) => ACTIVE.includes(t.status));
    if (active.length >= c.maxActiveTasks && !o.force)
      die(
        `concurrency ceiling reached (${active.length}/${c.maxActiveTasks}): ${active.map((t) => t.id).join(", ")}. Finish or block one first.`,
      );
    const id = `${new Date().toISOString().slice(0, 10)}-${slug(title)}`;
    if (fs.existsSync(taskPath(id))) die(`task exists: ${id}`);
    const accept = [].concat(o.accept === true || !o.accept ? [] : o.accept);
    save({
      id,
      title,
      kind: one(o.kind) || "build",
      status: "planned",
      branch: one(o.branch) || null,
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
  set(o) {
    const t = load(o._[0]);
    if (o.status) {
      const s = one(o.status);
      if (!STATUSES.includes(s)) die(`status must be one of ${STATUSES}`);
      if (s === "ready" || s === "done") {
        const last = t.gateRuns.at(-1);
        if (!last || !last.passed)
          die(
            `cannot mark ${s}: latest gate run ${last ? "failed" : "missing"}. Run: factory gates ${t.id}`,
          );
        if (codeChangedSince(last.head, "HEAD") && !o.force)
          die("cannot mark ready: HEAD moved since the last passing gate run. Re-run gates.");
        if (t.kind !== "maintain" && !t.review)
          die(
            `cannot mark ${s}: no recorded independent review (factory set ${t.id} --review approve|changes --reviewer <agent>)`,
          );
        if (t.review && t.review.verdict !== "approve")
          die("cannot mark ready: review verdict is not approve");
      }
      t.status = s;
    }
    if (o.branch) t.branch = one(o.branch);
    if (o.next) t.nextAction = one(o.next);
    if (o.note) t.notes.push({ at: new Date().toISOString(), text: one(o.note) });
    if (o.intervention) t.interventions += 1;
    if (o.accept) t.acceptance.push(...[].concat(o.accept));
    if (o.review)
      t.review = {
        verdict: one(o.review),
        reviewer: one(o.reviewer) || "unknown",
        head: sh("git rev-parse HEAD"),
        at: new Date().toISOString(),
      };
    if (o.pr) t.pr = one(o.pr);
    save(t);
    console.log(`${t.id}: ${t.status}`);
  },
  repair(o) {
    const t = load(o._[0]);
    const c = cfg();
    const issue = one(o.issue);
    if (!issue) die("usage: repair <id> --issue <key> --result fixed|failed [--note ...]");
    const prior = t.repairs.filter((r) => r.issue === issue);
    if (prior.length >= c.maxRepairAttempts) {
      t.status = "blocked";
      t.nextAction = `escalate: ${issue} failed ${prior.length} repairs`;
      save(t);
      die(
        `repair budget spent for "${issue}" (${prior.length}/${c.maxRepairAttempts}); task blocked — escalate to the user`,
      );
    }
    const result = one(o.result) || "failed";
    if (result === "failed" && prior.at(-1)?.note && prior.at(-1).note === one(o.note)) {
      t.status = "blocked";
      save(t);
      die("same failure recurred identically; task blocked — change approach or escalate");
    }
    t.repairs.push({
      issue,
      attempt: prior.length + 1,
      result,
      note: one(o.note) || "",
      at: new Date().toISOString(),
    });
    save(t);
    console.log(`repair ${prior.length + 1}/${c.maxRepairAttempts} for "${issue}": ${result}`);
  },
  gates(o) {
    const id = o._[0];
    const t = id ? load(id) : null;
    const c = cfg();
    const files = changedFiles(c.baseBranch);
    let sel = o.all ? c.gates : selectGates(c.gates, files);
    if (o.only) sel = c.gates.filter((g) => [].concat(o.only).includes(g.name));
    const run = {
      at: new Date().toISOString(),
      head: sh("git rev-parse HEAD"),
      results: [],
      passed: true,
    };
    const evDir = path.join(dir, "evidence", t?.id ?? "adhoc");
    fs.mkdirSync(evDir, { recursive: true });
    for (const g of sel) {
      const t0 = Date.now();
      console.log(`▶ ${g.name}: ${g.cmd}`);
      const r = spawnSync(g.cmd, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 1 << 28 });
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      const tail = out.split("\n").slice(-40).join("\n");
      const ok = r.status === 0;
      run.passed &&= ok;
      run.results.push({ gate: g.name, ok, ms: Date.now() - t0, tail: ok ? "" : tail });
      console.log(`${ok ? "✔" : "✘"} ${g.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (!ok) console.log(tail);
    }
    run.skipped = c.gates.filter((g) => !sel.includes(g)).map((g) => g.name);
    run.deferredToCI = c.deferredToCI ?? [];
    fs.writeFileSync(
      path.join(evDir, `gates-${run.at.replace(/[:.]/g, "-")}.json`),
      JSON.stringify(run, null, 2),
    );
    if (t) {
      t.gateRuns.push({
        at: run.at,
        head: run.head,
        passed: run.passed,
        gates: run.results.map((x) => `${x.gate}:${x.ok ? "pass" : "FAIL"}`),
        skipped: run.skipped,
      });
      save(t);
    }
    console.log(run.passed ? "GATES PASS" : "GATES FAIL");
    if (run.skipped.length) console.log(`skipped (not relevant to diff): ${run.skipped}`);
    if (run.deferredToCI.length) console.log(`deferred to CI: ${run.deferredToCI}`);
    process.exit(run.passed ? 0 : 1);
  },
  status(o) {
    const c = cfg();
    const head = sh("git rev-parse HEAD");
    const tasks = all();
    const branchOf = (t) =>
      t.branch &&
      (sh(`git rev-parse --verify -q ${t.branch}`) ||
        sh(`git rev-parse --verify -q origin/${t.branch}`));
    if (!tasks.length) return console.log("No factory tasks. Start one with /factory-build.");
    const rows = [];
    for (const t of tasks) {
      const warn = [];
      const bref = t.branch
        ? sh(`git rev-parse --verify -q ${t.branch}`)
          ? t.branch
          : sh(`git rev-parse --verify -q origin/${t.branch}`)
            ? `origin/${t.branch}`
            : null
        : null;
      if (["building", "verifying", "reviewing", "ready", "done"].includes(t.status)) {
        if (!t.branch) warn.push("no branch recorded");
        else if (!bref) warn.push(`branch ${t.branch} not found`);
        else if (
          t.status !== "done" &&
          (sh(`git rev-list --count ${c.baseBranch}..${bref}`) ?? "0") === "0" &&
          !sh(`git rev-parse --verify -q origin/${c.baseBranch}`)
        )
          warn.push("no commits beyond base");
      }
      const last = t.gateRuns.at(-1);
      if (["ready", "done"].includes(t.status) && (!last || !last.passed))
        warn.push("marked complete without a passing gate run");
      if (
        last &&
        bref &&
        codeChangedSince(last.head, bref) &&
        ["ready", "reviewing"].includes(t.status)
      )
        warn.push("gates are stale (branch moved since)");
      rows.push({ t, warn, last });
    }
    const active = rows.filter((r) => ACTIVE.includes(r.t.status));
    console.log(
      `Factory: ${active.length}/${c.maxActiveTasks} active · ${tasks.length} total · HEAD ${head?.slice(0, 7)}\n`,
    );
    for (const st of [
      "building",
      "verifying",
      "reviewing",
      "planned",
      "blocked",
      "ready",
      "done",
    ]) {
      for (const { t, warn, last } of rows.filter((r) => r.t.status === st)) {
        console.log(`[${st}] ${t.id} — ${t.title}`);
        console.log(
          `    gates: ${last ? (last.passed ? "pass" : "FAIL") + " " + last.gates.join(" ") : "none"} · repairs ${t.repairs.length} · interventions ${t.interventions}${t.pr ? " · PR " + t.pr : ""}`,
        );
        console.log(`    next: ${t.nextAction}`);
        for (const w of warn) console.log(`    ⚠ ${w}`);
      }
    }
  },
  metrics() {
    const tasks = all();
    const sum = (f) => tasks.reduce((a, t) => a + f(t), 0);
    const ms = sum((t) => t.gateRuns.length);
    console.log(
      JSON.stringify(
        {
          tasks: tasks.length,
          done: tasks.filter((t) => ["ready", "done"].includes(t.status)).length,
          blocked: tasks.filter((t) => t.status === "blocked").length,
          interventions: sum((t) => t.interventions),
          repairAttempts: sum((t) => t.repairs.length),
          unresolvedRepairs: sum(
            (t) =>
              new Set(t.repairs.filter((r) => r.result === "failed").map((r) => r.issue)).size -
              new Set(t.repairs.filter((r) => r.result === "fixed").map((r) => r.issue)).size,
          ),
          gateRuns: ms,
          gateRunsFailed: sum((t) => t.gateRuns.filter((g) => !g.passed).length),
        },
        null,
        2,
      ),
    );
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!commands[cmd]) die(`usage: factory.mjs <${Object.keys(commands).join("|")}> ...`);
  commands[cmd](parseArgs(rest));
}
