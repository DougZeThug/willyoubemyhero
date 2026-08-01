// Run server-side code from a test with a real Request behind it.
//
// Everything in require-auth.server.ts reads its token through
// `getRequestHeader`, which resolves out of h3's AsyncLocalStorage. Establishing
// that store — which is exactly what `requestHandler` does in production — means
// the auth guards run for real: a test that passes an admin token passes an
// actual HMAC-signed string through an actual header, and `requireAdmin`
// verifies it the same way production does.
//
// Server functions themselves are made directly callable by
// src/test/setup-server.ts, which replaces the babel-transformed
// `createServerFn` with a builder that still runs the validator and the handler.
import { requestHandler } from "@tanstack/react-start/server";

/** Run `fn` inside a request whose headers are `headers`. */
export async function withRequestHeaders<T>(
  headers: Record<string, string>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const request = new Request("http://localhost/_serverFn/test", {
    method: "POST",
    headers,
  });

  let result: unknown;
  let failure: unknown;
  let threw = false;

  // `requestHandler` hands its callback's promise straight to h3's response
  // coercion without awaiting it, so awaiting the handler alone can return
  // before the inner work has finished. This latch is what we wait on.
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const handler = requestHandler(async () => {
    try {
      result = await fn();
    } catch (error) {
      threw = true;
      failure = error;
    } finally {
      settle();
    }
    return new Response(null, { status: 204 });
  });

  await handler(request, {});
  await finished;

  if (threw) throw failure;
  return result as T;
}

export type CallOptions = {
  /** Payload for the function's inputValidator. */
  data?: unknown;
  /** Request headers — `x-admin-token` / `x-member-token` drive the auth guards. */
  headers?: Record<string, string>;
};

/**
 * Loose on purpose. A server function with no inputValidator is typed to accept
 * `data: undefined`, so a shared `{ data?: unknown }` parameter is not
 * assignable to it. `never[]` is contravariantly compatible with every server
 * function shape, and the cast inside is where the looseness is paid for.
 */
type AnyServerFn = (...args: never[]) => unknown;

export function callServerFn<T = unknown>(
  fn: AnyServerFn,
  { data, headers = {} }: CallOptions = {},
): Promise<T> {
  const invoke = fn as unknown as (opts: { data?: unknown }) => Promise<T>;
  return withRequestHeaders(headers, () => invoke({ data }));
}

/** Header bag for a request carrying an admin token. */
export function adminHeaders(token: string) {
  return { "x-admin-token": token };
}

/** Header bag for a request carrying a member token. */
export function memberHeaders(token: string) {
  return { "x-member-token": token };
}

/** Header bag for a request carrying an anonymous guest token. */
export function guestHeaders(token: string) {
  return { "x-guest-token": token };
}
