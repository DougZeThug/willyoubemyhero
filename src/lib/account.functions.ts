import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  optionalAccountHandoff,
  optionalGuest,
  optionalMember,
  requireMember,
} from "./require-auth.server";
import type { AccountSession } from "./account.server";

/**
 * Hand a signed-in device the token for whatever collection this account owns,
 * adopting the device's current identity the first time.
 *
 * The auth user comes from the verified bearer (`requireSupabaseAuth`), never
 * from the payload.
 */
export const syncAccountSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountSession> => {
    const { syncAccount } = await import("./account.server");
    const handoff = optionalAccountHandoff();
    return syncAccount(context.userId, {
      memberId: optionalMember() ?? (handoff?.kind === "member" ? handoff.id : null),
      guestIds: [optionalGuest(), handoff?.kind === "guest" ? handoff.id : null].filter(
        (id): id is string => Boolean(id),
      ),
    });
  });

/** Who this account is, for the header. */
export const getAccountIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ kind: "member" | "guest"; name: string | null }> => {
    const { syncAccount } = await import("./account.server");
    const handoff = optionalAccountHandoff();
    const session = await syncAccount(context.userId, {
      memberId: optionalMember() ?? (handoff?.kind === "member" ? handoff.id : null),
      guestIds: [optionalGuest(), handoff?.kind === "guest" ? handoff.id : null].filter(
        (id): id is string => Boolean(id),
      ),
    });
    return { kind: session.kind, name: session.name };
  });

/**
 * Called right after a paper-code claim while signed in, so the roster player
 * follows the account rather than the handset. The participant id is taken from
 * the freshly issued member token, not from the request body.
 */
export const linkClaimedPlayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const participantId = await requireMember();
    const { AccountAlreadyLinkedError, bindParticipant } = await import("./account.server");
    try {
      const bound = await bindParticipant(context.userId, participantId);
      return { ok: true as const, ...bound };
    } catch (e) {
      // The deliberate refusal comes back as data, not as a throw. The caller
      // has to tell it apart from a flaky request — it used to swallow both in
      // one catch and say "Welcome" either way, while the account went on
      // pointing at the OLD player for every other device.
      if (e instanceof AccountAlreadyLinkedError) {
        return { ok: false as const, reason: e.reason, boundName: e.boundName };
      }
      throw e;
    }
  });
