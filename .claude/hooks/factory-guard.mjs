#!/usr/bin/env node
// PreToolUse guard. Enforces what permission rules can't express well: path
// regexes for protected files and Bash patterns for destructive git/deploy
// commands. Reads .factory/project.json so the hook itself is project-agnostic.
// process.exit is the hook protocol: exit 2 blocks the call, stderr goes to the model.
// Limit: pattern matching on a shell string is not a sandbox. Real boundaries
// are the permission deny list, branch protection and the sandbox.
import fs from "node:fs";
import path from "node:path";

const readFile = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function decide(input, cfg, root) {
  const { tool_name: tool, tool_input: toolInput = {} } = input;
  if (["Edit", "Write", "NotebookEdit"].includes(tool)) {
    const target = toolInput.file_path ?? toolInput.notebook_path;
    if (!target) return null;
    const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");
    const hit = (cfg.protectedPaths ?? []).find((pattern) => new RegExp(pattern).test(rel));
    if (hit)
      return `factory-guard: ${rel} is protected (${cfg.protectedNote ?? hit}). Do not edit it; if the task truly needs it, stop and report to the Director.`;
  }
  if (tool === "Bash") {
    // Heredoc bodies are data (file contents, commit messages), not commands.
    const cmd = (toolInput.command ?? "").replace(
      /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g,
      "<<heredoc",
    );
    const hit = (cfg.blockedBashPatterns ?? []).find((pattern) => new RegExp(pattern).test(cmd));
    if (hit)
      return `factory-guard: command blocked by policy (${hit}). Pushing to main, force-pushing, rewriting history, deploying and DB resets need the user's explicit approval.`;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    // No project config means nothing to enforce; never block on our own setup.
    const cfg = parseJson(readFile(path.join(root, ".factory/project.json")));
    if (!cfg) process.exit(0);
    const input = parseJson(raw);
    if (!input) process.exit(0);
    const message = decide(input, cfg, root);
    if (message) {
      console.error(message);
      process.exit(2);
    }
  });
}
