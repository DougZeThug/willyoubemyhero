// A chainable stand-in for the supabase-js client.
//
// Every server function in this app reaches the database through
// `await import("@/integrations/supabase/client.server")`, so a single fake that
// speaks the PostgREST builder dialect saves each handler test from hand-rolling
// its own. Builders are thenables, exactly like the real ones, so both
// `await sb.from("x").select()` and `.maybeSingle()` resolve.
import { vi } from "vitest";

export type SupabaseResult = { data?: unknown; error?: unknown; count?: number | null };

type Op = "select" | "insert" | "update" | "upsert" | "delete";

export type RecordedCall = {
  table: string;
  op: Op;
  /** Rows handed to insert/update/upsert. */
  payload?: unknown;
  /** The column list handed to `.select("a, b")`, when it was given one. */
  columns?: string;
  /** Second argument to insert/upsert/select — e.g. `{ onConflict: "client_key" }`. */
  options?: unknown;
  /** Every chained refinement, in call order: eq, in, order, limit, select, … */
  filters: { method: string; args: unknown[] }[];
  terminal: "maybeSingle" | "single" | "await";
};

/**
 * Keyed `"<table>.<op>"` for queries, `"rpc.<name>"` for RPCs, and
 * `"storage.<method>"` for storage. A bare object always answers; an array is a
 * queue consumed in call order, for a table hit more than once with different
 * results; a function computes the answer from the recorded call.
 */
export type SupabaseResponses = Record<
  string,
  SupabaseResult | SupabaseResult[] | ((call: RecordedCall) => SupabaseResult)
>;

const EMPTY: Required<SupabaseResult> = { data: null, error: null, count: null };

export function createSupabaseMock(responses: SupabaseResponses = {}) {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, SupabaseResult[]>();

  function resolve(key: string, call?: RecordedCall): Required<SupabaseResult> {
    const configured = responses[key];
    if (configured === undefined) return { ...EMPTY };
    if (typeof configured === "function") {
      return { ...EMPTY, ...configured(call as RecordedCall) };
    }
    if (Array.isArray(configured)) {
      if (!queues.has(key)) queues.set(key, [...configured]);
      const queue = queues.get(key)!;
      // The last entry repeats once the queue drains, so a loop that upserts N
      // times doesn't need N identical entries.
      const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? {});
      return { ...EMPTY, ...next };
    }
    return { ...EMPTY, ...configured };
  }

  function builder(table: string) {
    const call: RecordedCall = { table, op: "select", filters: [], terminal: "await" };
    let opLocked = false;

    function finish(terminal: RecordedCall["terminal"]) {
      call.terminal = terminal;
      calls.push(call);
      return resolve(`${table}.${call.op}`, call);
    }

    const chain: Record<string, unknown> = {
      // Thenable, so `await sb.from("t").select().eq(...)` resolves like the real client.
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(finish("await")).then(onFulfilled, onRejected),
      maybeSingle: () => Promise.resolve(finish("maybeSingle")),
      single: () => Promise.resolve(finish("single")),
    };

    for (const op of ["select", "insert", "update", "upsert", "delete"] as const) {
      chain[op] = (payload?: unknown, options?: unknown) => {
        if (opLocked) {
          // `.insert(...).select().single()` — the trailing select shapes the
          // return, it does not start a new operation.
          call.filters.push({
            method: op,
            args: [payload, options].filter((a) => a !== undefined),
          });
        } else {
          call.op = op;
          opLocked = true;
          if (op === "select") {
            // The column list, kept because a handler that maps a field it never
            // asked for is a bug no mocked response can show: `resolve` returns
            // whatever the test declared regardless of what was selected, so the
            // round trip passes and only the real database disagrees.
            if (typeof payload === "string") call.columns = payload;
            if (options !== undefined) call.options = options;
          } else {
            call.payload = payload;
            if (options !== undefined) call.options = options;
          }
        }
        return chain;
      };
    }

    for (const method of [
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "gt",
      "lt",
      "gte",
      "lte",
      "order",
      "limit",
    ]) {
      chain[method] = (...args: unknown[]) => {
        call.filters.push({ method, args });
        return chain;
      };
    }

    // `.returns<T>()` and `.overrideTypes<T>()` only narrow the result type;
    // postgrest-js returns `this` from both. Recorded like any other refinement
    // so a test can still assert one was used, but they change nothing.
    for (const method of ["returns", "overrideTypes"]) {
      chain[method] = () => {
        call.filters.push({ method, args: [] });
        return chain;
      };
    }

    return chain;
  }

  const storageBucket = {
    createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
      const r = resolve("storage.createSignedUrl", {
        table: "storage",
        op: "select",
        filters: [{ method: "createSignedUrl", args: [path, expiresIn] }],
        terminal: "await",
      });
      return { data: r.data, error: r.error };
    }),
    // Parameters mirror the real signature so tests can assert on the path and
    // content type that were actually uploaded.
    upload: vi.fn(
      async (path: string, body: unknown, options?: { contentType?: string; upsert?: boolean }) => {
        void path;
        void body;
        void options;
        const r = resolve("storage.upload");
        return { data: r.data, error: r.error };
      },
    ),
    remove: vi.fn(async (paths: string[]) => {
      void paths;
      const r = resolve("storage.remove");
      return { data: r.data, error: r.error };
    }),
  };

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (name: string, args?: unknown) => {
      const r = resolve(`rpc.${name}`, {
        table: "rpc",
        op: "select",
        payload: args,
        filters: [{ method: name, args: [args] }],
        terminal: "await",
      });
      return { data: r.data, error: r.error };
    }),
    storage: { from: vi.fn(() => storageBucket) },
  };

  return {
    client,
    storageBucket,
    /** Every query the code under test issued, in order. */
    calls,
    /** Queries against one table, optionally narrowed to a single operation. */
    callsFor(table: string, op?: Op) {
      return calls.filter((c) => c.table === table && (op ? c.op === op : true));
    },
    /** The value passed to `.eq(column, value)` on a recorded call, if any. */
    eqValue(call: RecordedCall, column: string) {
      return call.filters.find((f) => f.method === "eq" && f.args[0] === column)?.args[1];
    },
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;
