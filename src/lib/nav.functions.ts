import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";
import { TOGGLEABLE_ROW_IDS } from "./nav";
import { uuid as zuuid } from "./zod-uuid";

/**
 * The commissioner's switch for which rows the bottom bar holds.
 *
 * Its own function rather than a field on `updateEvent`, for the same reason
 * `setDustEnabled` is: a feature switch reads better owned by the feature than
 * buried among the event's lock flags, and `updateEvent`'s validator already
 * carries a caution about optional booleans nothing ever calls.
 *
 * THE PIN IS A SERVER RULE. The validator accepts only the toggleable ids, so a
 * request naming `vault` or `shop` is refused at the edge rather than quietly
 * dropped by the client. A disabled button is a courtesy; this is the rule.
 *
 * Deduped on the way in, because the column is a set in everything but type and
 * a repeated id would make the admin panel's count disagree with the bar's.
 */
export const setNavHidden = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        hidden: z.array(z.enum(TOGGLEABLE_ROW_IDS)),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const hidden = [...new Set(data.hidden)];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The cast is the only way to write nav_hidden today: the column landed in
    // supabase/migrations/20260903170000_nav_rows.sql and the checked-in
    // generated types have not been regenerated since — the same drift
    // on_clock_since already carries. Cast the client rather than the patch, so
    // the payload stays a plain readable object. Regenerating types.ts retires
    // the whole line.
    const { error } = await (supabaseAdmin as unknown as SupabaseClient)
      .from("events")
      .update({ nav_hidden: hidden })
      .eq("id", data.eventId);
    if (error) throw new Error(error.message);
    return { ok: true as const, hidden };
  });
