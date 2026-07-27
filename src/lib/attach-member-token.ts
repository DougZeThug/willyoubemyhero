import { createMiddleware } from "@tanstack/react-start";
import { getMemberToken } from "./member-token";

export const attachMemberToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = getMemberToken();
  if (!token) return next();
  return next({ headers: { "x-member-token": token } });
});
