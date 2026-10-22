import { timingSafeEqual } from "node:crypto";

/** Constant-time bearer-token check for machine endpoints (ingest, cron). */
export function hasValidBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
