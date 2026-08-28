#!/usr/bin/env node
// Dry-run Dependabot updates locally. Downloads the Dependabot CLI if needed.
// The Dependabot CLI runs the updater in Docker without opening real PRs.
import { execSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { platform as osPlatform } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cacheDir = join(root, ".cache", "dependabot-cli");

function platformArch() {
  const platform = osPlatform();
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "386";
  return { platform, arch };
}

function assetSuffix(platform, arch) {
  if (platform === "win32") return `windows-${arch}.zip`;
  const mapped = platform === "darwin" ? "darwin" : "linux";
  return `${mapped}-${arch}.tar.gz`;
}

function findInPath(name) {
  const paths = (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":");
  for (const p of paths) {
    const candidate = join(p, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function hasDocker() {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const file = createWriteStream(dest);
  await pipeline(Readable.fromWeb(response.body), file);
}

async function downloadCli() {
  const { platform, arch } = platformArch();
  const suffix = assetSuffix(platform, arch);
  const latestUrl = "https://api.github.com/repos/dependabot/cli/releases/latest";

  console.log("Fetching latest Dependabot CLI release...");
  const releaseRes = await fetch(latestUrl);
  if (!releaseRes.ok) {
    throw new Error(
      `Failed to fetch latest release: ${releaseRes.status} ${releaseRes.statusText}`,
    );
  }
  const release = await releaseRes.json();
  const tag = release.tag_name;
  const assetName = `dependabot-${tag}-${suffix}`;
  const downloadUrl = `https://github.com/dependabot/cli/releases/download/${tag}/${assetName}`;
  const assetPath = join(cacheDir, assetName);
  const binaryName = platform === "win32" ? "dependabot.exe" : "dependabot";
  const binaryPath = join(cacheDir, binaryName);

  if (existsSync(binaryPath)) return binaryPath;

  await mkdir(cacheDir, { recursive: true });
  console.log(`Downloading ${downloadUrl}...`);
  await downloadFile(downloadUrl, assetPath);

  console.log("Extracting...");
  if (suffix.endsWith(".zip")) {
    execSync(`unzip -o ${assetPath} -d ${cacheDir}`, { stdio: "inherit" });
  } else {
    execSync(`tar -xzf ${assetPath} -C ${cacheDir}`, { stdio: "inherit" });
  }

  await rm(assetPath, { force: true });
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function main() {
  if (!hasDocker()) {
    console.warn("Docker is not available. The Dependabot CLI requires Docker to run.");
    console.warn("Start Docker and try again, or review .github/dependabot.yml manually.");
    process.exit(0);
  }

  const binaryName = process.platform === "win32" ? "dependabot.exe" : "dependabot";
  let binary = findInPath(binaryName);
  if (!binary) {
    const cached = join(cacheDir, binaryName);
    binary = existsSync(cached) ? cached : await downloadCli();
  }

  console.log("Running Dependabot dry-run for npm_and_yarn ecosystem...");
  const result = spawnSync(binary, ["update", "npm_and_yarn", ".", "--local", "."], {
    cwd: root,
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
