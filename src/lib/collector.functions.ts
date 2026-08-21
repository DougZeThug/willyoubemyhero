import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { optionalAccountHandoff, optionalGuest } from "./require-auth.server";
import type { CollectorIdentity } from "./collector.server";

/**
 * Give a signed-in non-player a name and a tradeable identity.
 *
 * Refuses a second one: `syncAccount` treats the account's participant row as
 * authoritative, so an overwrite would strand the first collection.
 */
export const createCollectorIdentity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ displayName: z.string().trim().min(2).max(32) }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<CollectorIdentity> => {
    const { createCollector } = await import("./collector.server");
    const handoff = optionalAccountHandoff();
    return createCollector(
      context.userId,
      data.displayName,
      [optionalGuest(), handoff?.kind === "guest" ? handoff.id : null].filter(
        (id): id is string => Boolean(id),
      ),
    );
  });
