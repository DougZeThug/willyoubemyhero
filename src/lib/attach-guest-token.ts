import { createMiddleware } from "@tanstack/react-start";
import { getGuestToken } from "./guest-token";

export const attachGuestToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = getGuestToken();
  if (!token) return next();
  return next({ headers: { "x-guest-token": token } });
});
