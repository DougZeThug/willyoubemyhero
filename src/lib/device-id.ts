// Who a pack belongs to when nobody has claimed a player.
//
// Packs are dealt per person now. A claimed member has an identity already; a
// guest standing in the garden with a borrowed phone does not, and refusing them
// a pack over it would be a worse answer than giving the handset one of its own.
import { useEffect, useState } from "react";
import { newClientKey } from "./format";
import { useMemberSession } from "./member-token";

const KEY = "wwbh:device-id";

/** Per-tab fallback, so a phone that cannot write still gets a stable pack. */
let sessionId: string | null = null;

/**
 * A random id for a phone that has no person behind it.
 *
 * Minted on first read and never rotated. localStorage rather than IndexedDB
 * because it has to be readable synchronously, in the same pass as the member
 * token — see usePackIdentity.
 */
export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const minted = newClientKey();
    window.localStorage.setItem(KEY, minted);
    return minted;
  } catch {
    // Private mode, or a full quota. An id that lasts one page load is a worse
    // promise than a persistent one, but a far better failure than no pack at
    // all — the same call card-collection.ts makes for a blocked IndexedDB.
    sessionId ??= newClientKey();
    return sessionId;
  }
}

/**
 * Who today's pack is being dealt to: `m:<participantId>` for a claimed member,
 * `d:<deviceId>` for anyone else. The prefixes are free insurance against a
 * device id ever colliding with a participant id.
 *
 * Null until the browser has answered, and the pack deals nothing until then.
 */
export function usePackIdentity(): string | null {
  // useMemberSession is called HERE, and first, on purpose. Both it and the
  // effect below resolve from a mount effect in the same component, so React
  // batches the two state updates into one re-render — which is what stops a
  // claimed member seeing a device-seeded pack, even for a single frame.
  const member = useMemberSession();
  const [device, setDevice] = useState<string | null>(null);

  // Never read during render: the server has no localStorage, and handing the
  // client a different first render than the one it is hydrating is the bug
  // use-photo-urls.ts and useMemberSession are both written around.
  useEffect(() => setDevice(deviceId()), []);

  if (!device) return null;
  return member ? `m:${member.participantId}` : `d:${device}`;
}
