import { createMiddleware } from "@tanstack/react-start";
import { getAccountHandoffToken } from "./account-handoff";

export const attachAccountHandoff = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = getAccountHandoffToken();
    if (!token) return next();
    return next({ headers: { "x-account-handoff-token": token } });
  },
);
