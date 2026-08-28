#!/usr/bin/env node
// Dry-run Dependabot updates locally. Downloads the Dependabot CLI if needed.
import { execSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
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

async function downloadCli() {
  const { platform, arch } = platformArch();
  const suffix = assetSuffix(platform, arch);
  const latestUrl = "https://api.github.com/repos/dependabot/cli/releases/latest";

  console.log("Fetching latest Dependabot CLI release...");
  const release = JSON.parse(execSync(`curl -sL ${latestUrl}`, { encoding: "utf8" }));
  const tag = release.tag_name;
  const assetName = `dependabot-${tag}-${suffix}`;
  const downloadUrl = `https://github.com/dependabot/cli/releases/download/${tag}/${assetName}`;
  const assetPath = join(cacheDir, assetName);
  const binaryPath = join(cacheDir, platform === "win32" ? "dependabot.exe" : "dependabot");

  if (existsSync(binaryPath)) return binaryPath;

  await mkdir(cacheDir, { recursive: true });
  console.log(`Downloading ${downloadUrl}...`);
  await new Promise((resolve, reject) => {
    const file = createWriteStream(assetPath);
    execSync(`curl -sL ${downloadUrl}`, { stdio: ["ignore", file, "pipe"] })
      .on("finish", resolve)
      .on("error", reject);
  });

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
  let binary = findInPath(process.platform === "win32" ? "dependabot.exe" : "dependabot");
  if (!binary) {
    const cached = join(cacheDir, process.platform === "win32" ? "dependabot.exe" : "dependabot");
    if (existsSync(cached)) {
      binary = cached;
    } else {
      binary = await downloadCli();
    }
  }

  console.log("Running Dependabot dry-run for npm_and_yarn ecosystem...");
  const result = spawnSync(binary, ["update", "npm_and_yarn", ".", "--dry-run"], {
    cwd: root,
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
