import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { attachAdminToken } from "@/lib/attach-admin-token";
import { attachMemberToken } from "@/lib/attach-member-token";
import { attachGuestToken } from "@/lib/attach-guest-token";
import { attachAccountHandoff } from "@/lib/attach-account-handoff";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // Server-function calls must keep their message. Swallowing them into the
    // HTML error page is what made a failed run save read "Could not reach the
    // server" on a phone that had perfect signal — the real reason (an expired
    // admin session, a rejected row) never made it back to the console.
    if (new URL(request.url).pathname.startsWith("/_serverFn")) {
      console.error(error);
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});


export const startInstance = createStart(() => ({
  functionMiddleware: [
    attachSupabaseAuth,
    attachAdminToken,
    attachMemberToken,
    attachGuestToken,
    attachAccountHandoff,
  ],
  requestMiddleware: [errorMiddleware],
}));
