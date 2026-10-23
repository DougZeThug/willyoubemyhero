// Run server-side code from a test with a real Request behind it.
//
// Everything in require-auth.server.ts reads its token through
// `getRequestHeader`, which resolves out of h3's AsyncLocalStorage. Establishing
// that store — which is exactly what the Start request entry does in production — means
// the auth guards run for real: a test that passes an admin token passes an
// actual HMAC-signed string through an actual header, and `requireAdmin`
// verifies it the same way production does.
//
// Server functions themselves are made directly callable by
// src/test/setup-server.ts, which replaces the babel-transformed
// `createServerFn` with a builder that still runs the validator and the handler.
import { createServerEntry } from "@tanstack/react-start/server";

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

  // `createServerEntry().fetch` runs its callback inside the same request scope
  // production uses, and awaits it. It turns anything the callback throws into a
  // 500 Response, so the callback captures its own error and we rethrow it
  // below; the caller still sees the original error, not a Response.
  const entry = createServerEntry({
    fetch: async () => {
      try {
        result = await fn();
      } catch (error) {
        threw = true;
        failure = error;
      }
      return new Response(null, { status: 204 });
    },
  });

  await entry.fetch(request, {});

  if (threw) throw failure;
  return result as T;
}

export type CallOptions = {
  /** Payload for the function's validator. */
  data?: unknown;
  /** Request headers — `x-admin-token` / `x-member-token` drive the auth guards. */
  headers?: Record<string, string>;
  /** Context a middleware would have supplied in production (e.g. `{ userId }`). */
  context?: Record<string, unknown>;
};

/**
 * Loose on purpose. A server function with no validator is typed to accept
 * `data: undefined`, so a shared `{ data?: unknown }` parameter is not
 * assignable to it. `never[]` is contravariantly compatible with every server
 * function shape, and the cast inside is where the looseness is paid for.
 */
type AnyServerFn = (...args: never[]) => unknown;

export function callServerFn<T = unknown>(
  fn: AnyServerFn,
  { data, headers = {}, context }: CallOptions = {},
): Promise<T> {
  const invoke = fn as unknown as (opts: {
    data?: unknown;
    context?: Record<string, unknown>;
  }) => Promise<T>;
  return withRequestHeaders(headers, () => invoke({ data, context }));
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
