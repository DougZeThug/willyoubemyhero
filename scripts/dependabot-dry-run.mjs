#!/usr/bin/env node
// Dry-run Dependabot updates locally. Requires Docker.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function hasDocker() {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasDocker()) {
  console.warn("Docker is not available. The Dependabot CLI requires Docker to run.");
  console.warn("Start Docker and try again, or review .github/dependabot.yml manually.");
  process.exit(0);
}

console.log("Running Dependabot dry-run for npm_and_yarn ecosystem...");
execSync("bunx @dependabot/cli update npm_and_yarn . --dry-run", {
  cwd: root,
  stdio: "inherit",
});
