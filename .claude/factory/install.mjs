#!/usr/bin/env node
// Install the factory into another repository.
//   node .claude/factory/install.mjs <target-repo> [--dry-run]
// Copies only the portable kit (agents, skills, hook, state tool, workflows),
// generates a minimal .factory/project.json from the target's package.json, and
// MERGES settings.json (union of lists) without overwriting existing entries.
// Project-specific rules are never copied: edit the generated project.json.
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(import.meta.dirname, "../..");
const target = path.resolve(process.argv[2] ?? "");
const dry = process.argv.includes("--dry-run");
if (!process.argv[2] || !fs.existsSync(path.join(target, ".git"))) {
  console.error("usage: install.mjs <path-to-git-repo> [--dry-run]");
  process.exit(1);
}
const log = (m) => console.log(`${dry ? "[dry] " : ""}${m}`);
const write = (p, c) => {
  log(`write ${path.relative(target, p)}`);
  if (!dry) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c);
  }
};

const portable = [
  ".claude/factory/factory.mjs",
  ".claude/factory/factory.test.mjs",
  ".claude/factory/director.md",
  ".claude/factory/install.mjs",
  ".claude/hooks/factory-guard.mjs",
  ...fs
    .readdirSync(path.join(src, ".claude/agents"))
    .filter((f) => f.startsWith("factory-"))
    .map((f) => `.claude/agents/${f}`),
  ...fs
    .readdirSync(path.join(src, ".claude/skills"))
    .filter((f) => f.startsWith("factory-"))
    .map((f) => `.claude/skills/${f}/SKILL.md`),
  ...fs
    .readdirSync(path.join(src, ".github/workflows"))
    .filter((f) => f.startsWith("factory-"))
    .map((f) => `.github/workflows/${f}`),
];
for (const f of portable) write(path.join(target, f), fs.readFileSync(path.join(src, f)));

// project.json: detect, never copy.
const projFile = path.join(target, ".factory/project.json");
if (fs.existsSync(projFile)) log("keep existing .factory/project.json");
else {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  } catch {}
  const pm = fs.existsSync(path.join(target, "bun.lock"))
    ? "bun run"
    : fs.existsSync(path.join(target, "pnpm-lock.yaml"))
      ? "pnpm run"
      : fs.existsSync(path.join(target, "yarn.lock"))
        ? "yarn"
        : "npm run";
  const gates = ["lint", "typecheck", "test", "build"]
    .filter((s) => pkg.scripts?.[s])
    .map((s) => ({ name: s, cmd: `${pm} ${s}` }));
  const base =
    fs.existsSync(path.join(target, ".git/refs/heads/master")) &&
    !fs.existsSync(path.join(target, ".git/refs/heads/main"))
      ? "master"
      : "main";
  write(
    projFile,
    JSON.stringify(
      {
        name: path.basename(target),
        baseBranch: base,
        maxActiveTasks: 1,
        maxRepairAttempts: 3,
        gates,
        deferredToCI: [],
        protectedPaths: ["^\\.env"],
        blockedBashPatterns: [
          "git\\s+push\\b.*(--force|-f\\b|--force-with-lease)",
          "git\\s+push\\b[^;&|]*[\\s:](main|master)(\\s|$)",
          "git\\s+(reset\\s+--hard\\s+origin|rebase|commit\\s+--amend)",
          "rm\\s+-rf?\\s+(/|~|\\.\\s*$)",
        ],
        domainAgents: {},
      },
      null,
      2,
    ) + "\n",
  );
}

// settings.json: union-merge.
const setFile = path.join(target, ".claude/settings.json");
const mine = JSON.parse(fs.readFileSync(path.join(src, ".claude/settings.json"), "utf8"));
const theirs = fs.existsSync(setFile) ? JSON.parse(fs.readFileSync(setFile, "utf8")) : {};
const union = (a = [], b = []) => [...new Set([...a, ...b])];
const merged = {
  ...theirs,
  permissions: {
    ...theirs.permissions,
    defaultMode: theirs.permissions?.defaultMode ?? mine.permissions.defaultMode,
    allow: union(theirs.permissions?.allow, mine.permissions.allow),
    deny: union(theirs.permissions?.deny, mine.permissions.deny),
  },
  hooks: { ...theirs.hooks },
};
for (const [ev, entries] of Object.entries(mine.hooks)) {
  const have = JSON.stringify(merged.hooks[ev] ?? []);
  merged.hooks[ev] = [
    ...(merged.hooks[ev] ?? []),
    ...entries.filter((e) => !have.includes(JSON.stringify(e.hooks[0].command).slice(1, -1))),
  ];
}
write(setFile, JSON.stringify(merged, null, 2) + "\n");

// CLAUDE.md pointer (append once).
const cm = path.join(target, "CLAUDE.md");
const ptr =
  "\n## Software factory\nThis repo uses the autonomous factory: `/factory-build`, `/factory-fix`, `/factory-review`, `/factory-polish`, `/factory-status`, `/factory-maintain`. Protocol: `.claude/factory/director.md`. Gates, protected paths and limits: `.factory/project.json`. Task state: `.factory/tasks/`.\n";
if (!fs.existsSync(cm) || !fs.readFileSync(cm, "utf8").includes("## Software factory"))
  write(cm, (fs.existsSync(cm) ? fs.readFileSync(cm, "utf8") : "# Project\n") + ptr);
log(
  "done. Next: edit .factory/project.json (gates, protectedPaths, domainAgents), commit, then try /factory-status.",
);
