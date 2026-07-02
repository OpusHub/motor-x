import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

// Auth do dashboard: cookie de sessão = `${exp}.${hmac(exp)}` com expiração
// embutida — não é password-equivalent e expira sozinho.

export const COOKIE_NAME = "xauth";
const SESSION_DAYS = 90;

function sessionKey(): Buffer {
  const material = `${process.env.DASHBOARD_PASSWORD ?? ""}:${process.env.CRON_SECRET ?? ""}:session-v1`;
  return createHash("sha256").update(material).digest();
}

function sign(exp: string): string {
  return createHmac("sha256", sessionKey()).update(exp).digest("hex");
}

export function makeSessionValue(): string {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${exp}.${sign(exp)}`;
}

export function isValidSessionValue(value: string | undefined): boolean {
  if (!value || !process.env.DASHBOARD_PASSWORD) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp), "hex");
  const got = Buffer.from(mac, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function isDashboardAuthed(req: NextRequest): boolean {
  return isValidSessionValue(req.cookies.get(COOKIE_NAME)?.value);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function isCronAuthed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const runSecret = req.headers.get("x-run-secret") ?? "";
  return safeEqual(auth, `Bearer ${secret}`) || safeEqual(runSecret, secret);
}
