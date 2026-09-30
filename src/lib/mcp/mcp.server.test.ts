// The /mcp endpoint, driven through the same request handlers the generated
// routes mount.
//
// Nothing else in the suite touches this server: the SPA never calls it, e2e
// stubs server functions rather than routes, and the generated route files are
// excluded from lint. A bump of @lovable.dev/mcp-js that broke the wire format
// would have left every other job green, so this pins the parts a connected
// client depends on — the tool list, the shape of a result, and what the
// endpoint refuses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTanStackMcpHandler,
  createTanStackOAuthProtectedResourceMetadataHandler,
} from "@lovable.dev/mcp-js/stacks/tanstack";
import { createSupabaseMock } from "@/test/supabase-mock";
import mcp from "./index";

let mock = createSupabaseMock();

vi.mock("./supabase", () => ({
  supabaseAnon: () => mock.client,
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OPTIONS = { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" };
const handle = createTanStackMcpHandler(mcp, OPTIONS);
const handleMetadata = createTanStackOAuthProtectedResourceMetadataHandler(mcp, OPTIONS);

const TOOL_NAMES = [
  "get_active_event",
  "list_roster",
  "get_leaderboard",
  "get_all_time_records",
  "list_awards",
];

type Rpc = { result?: Record<string, unknown>; error?: { message: string } };

/** A streamable-HTTP reply is either plain JSON or a single SSE `data:` frame. */
async function readRpc(response: Response): Promise<Rpc> {
  const text = await response.text();
  const frame = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(frame ? frame.slice("data:".length) : text) as Rpc;
}

function post(method: string, params?: unknown) {
  return handle({
    request: new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const rpc = await readRpc(await post("tools/call", { name, arguments: args }));
  return rpc.result as { isError?: boolean; content: { type: string; text: string }[] };
}

beforeEach(() => {
  mock = createSupabaseMock();
});

describe("/mcp", () => {
  it("initializes as the combine server, with no session id", async () => {
    const response = await post("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const rpc = await readRpc(response);

    expect(rpc.result?.serverInfo).toMatchObject({ name: "combine-champion", version: "0.1.0" });
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("lists exactly the five read-only tools", async () => {
    const rpc = await readRpc(await post("tools/list"));
    const tools = rpc.result?.tools as { name: string; annotations: { readOnlyHint: boolean } }[];

    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    // Unauthenticated endpoint: a tool that could write must never sneak in.
    expect(tools.every((t) => t.annotations.readOnlyHint === true)).toBe(true);
  });

  it("serves a 2026-07-28 client that never initializes", async () => {
    const response = await handle({
      request: new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      }),
    });
    const rpc = await readRpc(response);
    const tools = rpc.result?.tools as { name: string }[];

    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("refuses a cross-origin browser request", async () => {
    const response = await handle({
      request: new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    });

    expect(response.status).toBe(403);
  });

  it("advertises closed input schemas", async () => {
    const rpc = await readRpc(await post("tools/list"));
    const tools = rpc.result?.tools as {
      name: string;
      inputSchema: { additionalProperties?: boolean };
    }[];

    for (const tool of tools) expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it("returns ranked, formatted rows from get_leaderboard", async () => {
    mock = createSupabaseMock({
      "runs.select": {
        data: [
          { id: "r1", official_time_ms: 60_810 },
          { id: "r2", official_time_ms: 75_000 },
        ],
      },
    });

    const result = await callTool("get_leaderboard", { event_id: EVENT_ID, limit: 2 });
    const body = JSON.parse(result.content[0].text) as {
      event_id: string;
      leaderboard: { rank: number; time: string }[];
    };

    expect(result.isError).toBeFalsy();
    expect(body.event_id).toBe(EVENT_ID);
    expect(body.leaderboard.map((r) => r.rank)).toEqual([1, 2]);
    expect(body.leaderboard[0].time).toMatch(/\d/);

    const [run] = mock.callsFor("runs", "select");
    expect(mock.eqValue(run, "event_id")).toBe(EVENT_ID);
    expect(mock.eqValue(run, "is_official")).toBe(true);
  });

  it("surfaces a database failure as a tool error, not a transport error", async () => {
    mock = createSupabaseMock({ "runs.select": { error: { message: "boom" } } });

    const result = await callTool("get_leaderboard", { event_id: EVENT_ID });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("rejects an argument the tool does not declare instead of dropping it", async () => {
    const result = await callTool("get_leaderboard", { event_id: EVENT_ID, bogus: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("bogus");
    // The handler never ran.
    expect(mock.calls).toHaveLength(0);
  });

  it("answers GET with 405 — there is no standalone stream to open", async () => {
    const response = await handle({ request: new Request("http://localhost/mcp") });

    expect(response.status).toBe(405);
  });

  it("serves no OAuth metadata while the server is unauthenticated", async () => {
    const response = await handleMetadata({
      request: new Request("http://localhost/.well-known/oauth-protected-resource"),
    });

    expect(response.status).toBe(404);
  });
});
