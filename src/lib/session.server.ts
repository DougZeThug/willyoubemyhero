import type { SessionConfig } from "@tanstack/react-start/server";

export type AdminSession = { admin?: { eventId: string; unlockedAt: number } };

export function getSessionConfig(): SessionConfig {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "wwbh-admin",
    maxAge: 60 * 60 * 12, // 12h
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
  };
}

export function hashPin(salt: string, pin: string): string {
  // Kept out of .functions.ts on purpose (serverFn splitting).
  // Uses Node crypto; server-only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(`${salt}::${pin}`).digest("hex");
}

export function timingSafeEq(a: string, b: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}