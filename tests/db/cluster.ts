// Stand up a throwaway Postgres for the integration suite.
//
// Deliberately a local cluster rather than `supabase start`: these tests need
// Postgres, not the whole Supabase stack, and dropping the Docker dependency
// means they run in CI in seconds and on any machine with postgres installed.
// The platform pieces the migrations actually touch — the three roles, the
// realtime publication, the storage schema — are recreated by bootstrap.sql.
//
// The trade-off is honest: this is a faithful stand-in for the *database*, not
// for PostgREST or GoTrue. It proves the grants, the policies and the RPCs;
// it does not prove the API layer in front of them.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Fixed locations, tried after any versioned /usr/lib/postgresql/<n>/bin.
const PG_FIXED_DIRS = [
  "/usr/local/bin",
  // Nix-style images (the Lovable sandbox among them) put the postgres
  // binaries straight on PATH rather than in a versioned directory.
  "/usr/bin",
  "/bin",
];

/** Newest first. A hard-coded major version went stale the day a runner image moved on. */
export function versionedBinDirs(root = "/usr/lib/postgresql"): string[] {
  try {
    return readdirSync(root)
      .filter((v) => /^\d+(\.\d+)?$/.test(v))
      .sort((a, b) => Number(b) - Number(a))
      .map((v) => path.join(root, v, "bin"));
  } catch {
    return [];
  }
}

export const DB_NAME = "wwbh_test";
const OWNER = "wwbh_owner";

/**
 * PG_BIN_DIR wins when it really holds initdb. A value pointing at a directory that
 * does not exist (CI's fallback guess for a runner without pg_ctl on PATH) falls
 * through to the search instead of failing the whole suite.
 */
export function pickPgBinDir(opts: {
  fromEnv?: string;
  versioned: string[];
  fixed: string[];
  has: (dir: string) => boolean;
}): string {
  if (opts.fromEnv && opts.has(opts.fromEnv)) return opts.fromEnv;
  for (const dir of [...opts.versioned, ...opts.fixed]) {
    if (opts.has(dir)) return dir;
  }
  throw new Error(
    "No postgres binaries found. Install postgresql, or set PG_BIN_DIR to the directory holding initdb.",
  );
}

function pgBinDir(): string {
  return pickPgBinDir({
    fromEnv: process.env.PG_BIN_DIR,
    versioned: versionedBinDirs(),
    fixed: PG_FIXED_DIRS,
    has: (dir) => existsSync(path.join(dir, "initdb")),
  });
}

export type Cluster = {
  connectionString: string;
  stop: () => Promise<void>;
};

/**
 * Postgres refuses to run as root, and container-based CI often does.
 *
 * When we are root, every postgres binary is invoked through `setpriv` as the
 * `postgres` system user instead. A normal developer machine and a GitHub
 * Actions runner both run unprivileged, so this branch is dead there.
 */
function privilegeDropper() {
  if (process.getuid?.() !== 0) {
    return { wrap: (cmd: string, args: string[]) => ({ cmd, args }), needsChown: false };
  }
  const user = process.env.PG_RUN_AS ?? "postgres";
  return {
    needsChown: true,
    user,
    wrap: (cmd: string, args: string[]) => ({
      cmd: "setpriv",
      args: [`--reuid=${user}`, `--regid=${user}`, "--clear-groups", cmd, ...args],
    }),
  };
}

/**
 * initdb + start + create database + apply bootstrap.sql and every migration in
 * filename order, which is the same order the Supabase CLI applies them in.
 */
export async function startCluster(): Promise<Cluster> {
  const bin = pgBinDir();
  const dropper = privilegeDropper();
  const root = await mkdtemp(path.join(tmpdir(), "wwbh-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "sock");
  await run("mkdir", ["-p", socketDir]);
  if (dropper.needsChown) {
    // The cluster's own user has to own everything it writes to.
    await run("chmod", ["755", root]);
    await run("chown", ["-R", `${dropper.user}:${dropper.user}`, root]);
  }

  const env = { ...process.env, PGHOST: socketDir, PGUSER: OWNER, PGDATABASE: "postgres" };
  const pg = (name: string, args: string[]) => {
    const { cmd, args: full } = dropper.wrap(path.join(bin, name), args);
    return run(cmd, full, { env, maxBuffer: 32 * 1024 * 1024 });
  };

  await pg("initdb", ["-D", dataDir, "-U", OWNER, "--auth=trust", "--encoding=UTF8"]);

  // A unix socket in a temp dir keeps the cluster off every TCP port, so
  // concurrent runs and a developer's own postgres never collide.
  //
  // `-l` is not optional here: without it the server daemon inherits our stdout
  // pipe and holds it open, and execFile waits forever for a stream that never
  // closes even though pg_ctl itself exited.
  await pg("pg_ctl", [
    "-D",
    dataDir,
    "-l",
    path.join(root, "server.log"),
    "-o",
    `-k ${socketDir} -c listen_addresses=''`,
    "-w",
    "start",
  ]);

  const stop = async () => {
    try {
      await pg("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    } catch {
      /* already down */
    }
    await rm(root, { recursive: true, force: true });
  };

  try {
    await pg("createdb", [DB_NAME]);
    await applySchema(pg);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    connectionString: `postgresql://${OWNER}@localhost/${DB_NAME}?host=${encodeURIComponent(socketDir)}`,
    stop,
  };
}

type PgRunner = (name: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

/** Every migration, in the order the Supabase CLI would apply them. */
export async function migrationFiles(): Promise<string[]> {
  const dir = path.resolve(import.meta.dirname, "../../supabase/migrations");
  const names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return names.map((n) => path.join(dir, n));
}

async function applySchema(pg: PgRunner) {
  const files = [path.resolve(import.meta.dirname, "bootstrap.sql"), ...(await migrationFiles())];
  for (const file of files) {
    // ON_ERROR_STOP so a broken migration fails the run at that statement
    // rather than cascading into a hundred confusing follow-on errors.
    const { stderr } = await pg("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", DB_NAME, "-f", file]);
    if (/^ERROR/m.test(stderr)) {
      throw new Error(`${path.basename(file)} failed:\n${stderr}`);
    }
  }
}

/** Read a migration's text, for tests that assert on its contents. */
export function readMigration(file: string) {
  return readFile(file, "utf8");
}
