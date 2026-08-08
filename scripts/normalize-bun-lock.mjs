import { readFile, writeFile } from "node:fs/promises";

const lockfilePath = new URL("../bun.lock", import.meta.url);
const lockfile = await readFile(lockfilePath, "utf8");
const absoluteResolution = /(\["[^"\n]+", )"https:\/\/[^"\n]+"/g;
const matches = lockfile.match(absoluteResolution) ?? [];

if (matches.length === 0) {
  console.log("bun.lock already has portable package resolutions.");
  process.exit(0);
}

const normalized = lockfile.replace(absoluteResolution, '$1""');
await writeFile(lockfilePath, normalized);
console.log(`Normalized ${matches.length} absolute bun.lock resolution(s).`);
