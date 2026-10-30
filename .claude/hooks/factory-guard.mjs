#!/usr/bin/env node
// PreToolUse guard. Enforces what permission rules can't express well: path
// regexes for protected files and Bash patterns for destructive git/deploy
// commands. Reads .factory/project.json so the hook itself is project-agnostic.
// Exit 2 blocks the call and feeds stderr back to the model.
// Limit: pattern matching on a shell string is not a sandbox. Real boundaries
// are the permission deny list, branch protection and the sandbox.
import fs from "node:fs";
import path from "node:path";

export function decide(input, cfg, root) {
  const { tool_name: tool, tool_input: ti = {} } = input;
  if (["Edit", "Write", "NotebookEdit"].includes(tool)) {
    const p = ti.file_path ?? ti.notebook_path;
    if (!p) return null;
    const rel = path.relative(root, path.resolve(root, p)).split(path.sep).join("/");
    const hit = (cfg.protectedPaths ?? []).find((re) => new RegExp(re).test(rel));
    if (hit)
      return `factory-guard: ${rel} is protected (${cfg.protectedNote ?? hit}). Do not edit it; if the task truly needs it, stop and report to the Director.`;
  }
  if (tool === "Bash") {
    // Heredoc bodies are data (file contents, commit messages), not commands.
    const cmd = (ti.command ?? "").replace(
      /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g,
      "<<heredoc",
    );
    const hit = (cfg.blockedBashPatterns ?? []).find((re) => new RegExp(re).test(cmd));
    if (hit)
      return `factory-guard: command blocked by policy (${hit}). Pushing to main, force-pushing, rewriting history, deploying and DB resets need the user's explicit approval.`;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(root, ".factory/project.json"), "utf8"));
    } catch {
      process.exit(0);
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    const msg = decide(input, cfg, root);
    if (msg) {
      console.error(msg);
      process.exit(2);
    }
  });
}
