import type { SessionConfig } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

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
  return createHash("sha256").update(`${salt}::${pin}`).digest("hex");
}

export function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}