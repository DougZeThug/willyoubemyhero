// Node-environment setup: make `createServerFn` directly callable.
//
// In production the TanStack Start babel plugin rewrites
// `createServerFn().handler(fn)` into `handler(generatedFetcher, fn)`, and the
// runtime relies on that second argument. Vitest does not run that transform,
// so an un-transformed server function drops its return value on the floor.
//
// Rather than reconstruct the RPC plumbing — framework code we don't own and
// don't need to test — `createServerFn` is replaced with a builder that keeps
// the parts that *are* ours: the inputValidator still runs (so zod rejections
// are real), and the handler body still runs against the real request headers
// established by `callServerFn`, so requireAdmin/requireMember verify actual
// HMAC tokens.
import { vi } from "vitest";

function testCreateServerFn() {
  let validator: ((data: unknown) => unknown) | undefined;

  const builder = {
    middleware: () => builder,
    validator: (v: (data: unknown) => unknown) => {
      validator = v;
      return builder;
    },
    inputValidator: (v: (data: unknown) => unknown) => {
      validator = v;
      return builder;
    },
    handler:
      (fn: (ctx: { data: unknown; context: Record<string, unknown> }) => unknown) =>
      async (opts?: { data?: unknown }) => {
        const data = validator ? validator(opts?.data) : opts?.data;
        return fn({ data, context: {} });
      },
  };

  return builder;
}

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createServerFn: testCreateServerFn };
});
