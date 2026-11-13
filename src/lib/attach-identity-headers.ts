import { createMiddleware } from "@tanstack/react-start";
import { getAccountHandoffToken } from "./account-handoff";
import { getAdminToken } from "./admin-token";
import { getGuestToken } from "./guest-token";
import { getMemberToken } from "./member-token";
import { TOKEN_HEADERS } from "./token-format";

/**
 * Send whichever signed tokens this device holds with every server function.
 * require-auth.server.ts reads them back by the same header names.
 */
export const attachIdentityHeaders = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const tokens = {
      [TOKEN_HEADERS.admin]: getAdminToken(),
      [TOKEN_HEADERS.member]: getMemberToken(),
      [TOKEN_HEADERS.guest]: getGuestToken(),
      [TOKEN_HEADERS.accountHandoff]: getAccountHandoffToken(),
    };
    const headers: Record<string, string> = {};
    for (const [name, token] of Object.entries(tokens)) if (token) headers[name] = token;
    return Object.keys(headers).length ? next({ headers }) : next();
  },
);
