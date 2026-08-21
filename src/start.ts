import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { attachAdminToken } from "@/lib/attach-admin-token";
import { attachMemberToken } from "@/lib/attach-member-token";
import { attachGuestToken } from "@/lib/attach-guest-token";
import { attachAccountHandoff } from "@/lib/attach-account-handoff";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
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
