// One cluster for the whole db project, torn down when the run ends.
import type { TestProject } from "vitest/node";
import { startCluster, type Cluster } from "./cluster";

let cluster: Cluster | undefined;

export async function setup(project: TestProject) {
  cluster = await startCluster();
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
