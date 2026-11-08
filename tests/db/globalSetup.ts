// One cluster for the whole db project, torn down when the run ends.
import type { TestProject } from "vitest/node";
import { startCluster, type Cluster } from "./cluster";

let cluster: Cluster | undefined;

export async function setup(project: TestProject) {
  try {
    cluster = await startCluster();
  } catch (err) {
    // Vitest prints a startup error through a source-map lookup that itself throws
    // on some Vite builds ("code.charCodeAt is not a function"), which buries the
    // real reason under a crash and a misleading "No test files found". Say it
    // plainly first.
    console.error(`[db globalSetup] could not start Postgres: ${(err as Error).message}`);
    throw err;
  }
  // Test files run in their own workers, so the connection string is handed
  // across rather than shared in memory.
  project.provide("databaseUrl", cluster.connectionString);
}

export async function teardown() {
  await cluster?.stop();
}

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
