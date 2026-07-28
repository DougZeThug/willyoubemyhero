// Card artwork: signed URLs, uploads, and the cache that keeps a URL string
// stable so the browser's own HTTP cache can do its job.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

// The public client is built with createClient directly rather than imported,
// so it is stubbed at the supabase-js boundary.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mock.client,
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-0000000000ee";
const CARD_ID = "00000000-0000-4000-8000-000000000011";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";

/** A 1×1 transparent PNG. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const threeSizes = (large: string) => ({ thumb: large, medium: large, large });

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asAdmin = (eventId = EVENT_ID) => adminHeaders(signAdminToken(eventId).token);

/** Each test needs the module's signed-url cache empty. */
async function freshModule() {
  vi.resetModules();
  return import("./media.functions");
}

/** Mint a distinct signed URL per call, so cache hits are visible. */
function signingCounter() {
  let n = 0;
  return {
    get count() {
      return n;
    },
    response: () => ({ data: { signedUrl: `https://cdn/signed-${++n}` }, error: null }),
  };
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.useRealTimers();
  withDb();
});

describe("signed url cache", () => {
  it("hands back the same url set for the same object", async () => {
    // A fresh token per call is what made 30 full-size images re-download on
    // every refetch: the browser had never seen the URL before.
    const signer = signingCounter();
    withDb({
      "event_participants.select": { data: [{ id: CARD_ID, photo_path: "photos/a.jpg" }] },
      "storage.createSignedUrl": signer.response,
    });
    const mod = await freshModule();

    const first = await callServerFn(mod.getEventPhotoUrls, { data: { eventId: EVENT_ID } });
    const second = await callServerFn(mod.getEventPhotoUrls, { data: { eventId: EVENT_ID } });

    expect(first).toEqual(second);
    expect(signer.count).toBe(1);
  });

  it("re-signs once the reuse window has passed", async () => {
    const signer = signingCounter();
    withDb({
      "event_participants.select": { data: [{ id: CARD_ID, photo_path: "photos/a.jpg" }] },
      "storage.createSignedUrl": signer.response,
    });
    const mod = await freshModule();
    await callServerFn(mod.getEventPhotoUrls, { data: { eventId: EVENT_ID } });

    // Reuse lasts 6h; the token itself is good for 8h.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 7 * 60 * 60_000);
    const later = (await callServerFn(mod.getEventPhotoUrls, {
      data: { eventId: EVENT_ID },
    })) as Record<string, import("./media.functions").ImageUrlSet>;
    expect(signer.count).toBe(2);
    expect(later[CARD_ID]).toEqual({
      thumb: "https://cdn/signed-2",
      medium: "https://cdn/signed-2",
      large: "https://cdn/signed-2",
    });
  });

  it("signs one object once even when many cards ask at the same moment", async () => {
    // The in-flight map is what stops two concurrent requests minting two URLs
    // for the same file.
    const signer = signingCounter();
    withDb({
      "event_participants.select": {
        data: [
          { id: "ep-1", card_path: "cards/shared.webp", card_back_path: null },
          { id: "ep-2", card_path: "cards/shared.webp", card_back_path: null },
          { id: "ep-3", card_path: "cards/shared.webp", card_back_path: null },
        ],
      },
      "events.select": { data: { card_back_path: null } },
      "storage.createSignedUrl": signer.response,
    });
    const mod = await freshModule();
    const urls = (await callServerFn(mod.getEventCardUrls, {
      data: { eventId: EVENT_ID },
    })) as Record<string, { front: import("./media.functions").ImageUrlSet | null }>;

    expect(signer.count).toBe(1);
    expect(urls["ep-1"].front).toBe(urls["ep-3"].front);
  });

  it("returns nothing for a participant with no artwork", async () => {
    withDb({ "event_participants.select": { data: [{ id: CARD_ID, photo_path: null }] } });
    const mod = await freshModule();
    expect(await callServerFn(mod.getEventPhotoUrls, { data: { eventId: EVENT_ID } })).toEqual({});
  });

  it("omits a card whose signing failed rather than emitting a broken url", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_ID, photo_path: "photos/a.jpg" }] },
      "storage.createSignedUrl": { data: null, error: { message: "not found" } },
    });
    const mod = await freshModule();
    expect(await callServerFn(mod.getEventPhotoUrls, { data: { eventId: EVENT_ID } })).toEqual({});
  });
});

describe("getEventCardUrls", () => {
  it("prefers a player's own back over the event's universal one", async () => {
    const signer = signingCounter();
    withDb({
      "event_participants.select": {
        data: [{ id: CARD_ID, card_path: "cards/front.webp", card_back_path: "cards/own.webp" }],
      },
      "events.select": { data: { card_back_path: "cards/universal.webp" } },
      "storage.createSignedUrl": signer.response,
    });
    const mod = await freshModule();
    const urls = (await callServerFn(mod.getEventCardUrls, {
      data: { eventId: EVENT_ID },
    })) as Record<string, { front: import("./media.functions").ImageUrlSet | null; back: import("./media.functions").ImageUrlSet | null }>;
    // universal, front, own — three distinct objects, three distinct url sets.
    expect(signer.count).toBe(3);
    expect(urls[CARD_ID].back).not.toBeNull();
    expect(urls[CARD_ID].back).not.toBe(urls[CARD_ID].front);
  });

  it("falls back to the universal back", async () => {
    withDb({
      "event_participants.select": {
        data: [{ id: CARD_ID, card_path: "cards/front.webp", card_back_path: null }],
      },
      "events.select": { data: { card_back_path: "cards/universal.webp" } },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/u" }, error: null },
    });
    const mod = await freshModule();
    const urls = (await callServerFn(mod.getEventCardUrls, {
      data: { eventId: EVENT_ID },
    })) as Record<string, { back: import("./media.functions").ImageUrlSet | null }>;
    expect(urls[CARD_ID].back).toEqual({ thumb: "https://cdn/u", medium: "https://cdn/u", large: "https://cdn/u" });
  });

  it("includes a player with no art of their own once a universal back exists", async () => {
    withDb({
      "event_participants.select": {
        data: [{ id: CARD_ID, card_path: null, card_back_path: null }],
      },
      "events.select": { data: { card_back_path: "cards/universal.webp" } },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/u" }, error: null },
    });
    const mod = await freshModule();
    const urls = (await callServerFn(mod.getEventCardUrls, {
      data: { eventId: EVENT_ID },
    })) as Record<string, { front: import("./media.functions").ImageUrlSet | null; back: import("./media.functions").ImageUrlSet | null }>;
    expect(urls[CARD_ID]).toEqual({ front: null, back: { thumb: "https://cdn/u", medium: "https://cdn/u", large: "https://cdn/u" } });
  });

  it("drops a player with no art when there is no universal back either", async () => {
    withDb({
      "event_participants.select": {
        data: [{ id: CARD_ID, card_path: null, card_back_path: null }],
      },
      "events.select": { data: { card_back_path: null } },
    });
    const mod = await freshModule();
    expect(await callServerFn(mod.getEventCardUrls, { data: { eventId: EVENT_ID } })).toEqual({});
  });

  it("is readable without any session — the vault is public", async () => {
    withDb({
      "event_participants.select": { data: [] },
      "events.select": { data: { card_back_path: null } },
    });
    const mod = await freshModule();
    await expect(
      callServerFn(mod.getEventCardUrls, { data: { eventId: EVENT_ID } }),
    ).resolves.toEqual({});
  });
});

describe("uploads", () => {
  async function upload(dataUrls: { thumb: string; medium: string; large: string }, headers = asAdmin()) {
    withDb({
      "storage.upload": { data: { path: "ok" }, error: null },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/new" }, error: null },
    });
    const mod = await freshModule();
    return callServerFn(mod.uploadParticipantCard, {
      data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "front", dataUrls },
      headers,
    });
  }

  it("requires the commissioner", async () => {
    const mod = await freshModule();
    await expect(
      callServerFn(mod.uploadParticipantCard, {
        data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) },
      }),
    ).rejects.toThrow("Admin PIN required");
  });

  it("refuses a member token", async () => {
    const mod = await freshModule();
    await expect(
      callServerFn(mod.uploadParticipantCard, {
        data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) },
        headers: memberHeaders(signMemberToken(PARTICIPANT_ID).token),
      }),
    ).rejects.toThrow("Admin PIN required");
  });

  it("refuses an admin for a different event", async () => {
    const mod = await freshModule();
    await expect(
      callServerFn(mod.uploadParticipantCard, {
        data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) },
        headers: asAdmin(OTHER_EVENT_ID),
      }),
    ).rejects.toThrow("Admin PIN required");
  });

  it("accepts a png and points card_path at it", async () => {
    await upload(threeSizes(PNG));
    const [update] = mock.callsFor("event_participants", "update");
    expect(update.payload).toHaveProperty("card_path");
    expect(update.payload).not.toHaveProperty("card_back_path");
    expect(mock.storageBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^cards\/.+-front-\d+\.png$/),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "image/png" }),
    );
  });

  it("writes the back face to its own column", async () => {
    withDb({
      "storage.upload": { data: { path: "ok" }, error: null },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/new" }, error: null },
    });
    const mod = await freshModule();
    await callServerFn(mod.uploadParticipantCard, {
      data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "back", dataUrls: threeSizes(PNG) },
      headers: asAdmin(),
    });
    const [update] = mock.callsFor("event_participants", "update");
    expect(update.payload).toHaveProperty("card_back_path");
    expect(update.payload).not.toHaveProperty("card_path");
  });

  it.each([
    ["a jpeg", "data:image/jpeg;base64,/9j/4AAQSkZJRg=="],
    ["a webp", "data:image/webp;base64,UklGRh4AAABXRUJQ"],
  ])("accepts %s", async (_label, dataUrl) => {
    await expect(upload(threeSizes(dataUrl))).resolves.toBeTruthy();
  });

  it("normalises a jpg extension to jpeg", async () => {
    await upload(threeSizes("data:image/jpg;base64,/9j/4AAQSkZJRg=="));
    expect(mock.storageBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.jpeg$/),
      expect.any(Uint8Array),
      expect.anything(),
    );
  });

  it.each([
    ["an svg, which can carry script", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["a gif", "data:image/gif;base64,R0lGODlhAQABAAAAACw="],
    ["a pdf dressed as a data url", "data:application/pdf;base64,JVBERi0xLjQK"],
    ["bare base64 with no data url wrapper", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAA"],
    ["a remote url", "https://example.com/evil.png?x=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ])("rejects %s", async (_label, dataUrl) => {
    await expect(upload(threeSizes(dataUrl))).rejects.toThrow("Unsupported image format");
  });

  it("gives every upload a distinct path, so a re-upload cannot be cached stale", async () => {
    withDb({
      "storage.upload": { data: { path: "ok" }, error: null },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/new" }, error: null },
    });
    const mod = await freshModule();
    for (let i = 0; i < 2; i++) {
      await callServerFn(mod.uploadParticipantCard, {
        data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) },
        headers: asAdmin(),
      });
    }
    const paths = mock.storageBucket.upload.mock.calls.map((c) => c[0]);
    expect(paths[0]).toContain(`cards/${EVENT_ID}/${CARD_ID}-front-`);
    expect(paths).toHaveLength(2);
  });

  it("surfaces a storage failure instead of pointing the row at nothing", async () => {
    withDb({ "storage.upload": { data: null, error: { message: "bucket full" } } });
    const mod = await freshModule();
    await expect(
      callServerFn(mod.uploadParticipantCard, {
        data: { eventId: EVENT_ID, eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) },
        headers: asAdmin(),
      }),
    ).rejects.toBeTruthy();
    expect(mock.callsFor("event_participants", "update")).toHaveLength(0);
  });
});

describe("uploadParticipantCardsBulk", () => {
  it("requires the commissioner", async () => {
    const mod = await freshModule();
    await expect(
      callServerFn(mod.uploadParticipantCardsBulk, {
        data: {
          eventId: EVENT_ID,
          items: [{ eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) }],
        },
      }),
    ).rejects.toThrow("Admin PIN required");
  });

  it("reports per-item outcomes and keeps going past a bad one", async () => {
    withDb({
      "storage.upload": { data: { path: "ok" }, error: null },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/new" }, error: null },
    });
    const mod = await freshModule();
    const res = (await callServerFn(mod.uploadParticipantCardsBulk, {
      data: {
        eventId: EVENT_ID,
        items: [
          { eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) },
          {
            eventParticipantId: CARD_ID,
            side: "back",
            dataUrls: threeSizes("data:image/gif;base64,R0lGODlhAQABAAAAACw="),
          },
        ],
      },
      headers: asAdmin(),
    })) as { ok: boolean; results: { ok: boolean; error?: string }[] };

    expect(res.ok).toBe(false);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[1]).toMatchObject({ ok: false, error: "Unsupported image format" });
  });

  it("rejects an empty batch and one over the 40-item cap", async () => {
    const mod = await freshModule();
    const item = { eventParticipantId: CARD_ID, side: "front", dataUrls: threeSizes(PNG) };
    await expect(
      callServerFn(mod.uploadParticipantCardsBulk, {
        data: { eventId: EVENT_ID, items: [] },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
    await expect(
      callServerFn(mod.uploadParticipantCardsBulk, {
        data: { eventId: EVENT_ID, items: Array.from({ length: 41 }, () => item) },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
  });
});

describe("getEventCardBack", () => {
  it("returns null urls when the event has no universal back", async () => {
    withDb({ "events.select": { data: { card_back_path: null } } });
    const mod = await freshModule();
    expect(await callServerFn(mod.getEventCardBack, { data: { eventId: EVENT_ID } })).toEqual({
      urls: { thumb: null, medium: null, large: null },
    });
  });

  it("signs the back when there is one", async () => {
    withDb({
      "events.select": { data: { card_back_path: "cards/universal.webp" } },
      "storage.createSignedUrl": { data: { signedUrl: "https://cdn/u" }, error: null },
    });
    const mod = await freshModule();
    expect(await callServerFn(mod.getEventCardBack, { data: { eventId: EVENT_ID } })).toEqual({
      urls: { thumb: "https://cdn/u", medium: "https://cdn/u", large: "https://cdn/u" },
    });
  });
});
