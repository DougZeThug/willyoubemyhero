import { createMiddleware } from "@tanstack/react-start";
import { getAdminToken } from "./admin-token";

export const attachAdminToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = getAdminToken();
  if (!token) return next();
  return next({ headers: { "x-admin-token": token } });
});
