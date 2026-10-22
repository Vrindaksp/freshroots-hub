import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Password gate for the whole app (HTTP Basic auth). It exists because the hub has no user accounts yet:
 * without it, anyone with the URL could approve purchase orders or spend Gemini quota.
 *
 *  - APP_PASSWORD set     → any username, that password.
 *  - APP_PASSWORD unset   → open in development, LOCKED (503) in production, so a missing variable never exposes the app.
 *
 * /api/ingest and /api/cron are excluded by the matcher: they authenticate with their own bearer tokens.
 * This is a stop-gap, not user management — swap it for SSO when per-person audit trails matter.
 */

function safeEqual(a: string, b: string): boolean {
  // Constant-time compare so response timing does not leak how much of the password matched.
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function passwordFrom(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6));
    const colon = decoded.indexOf(":");
    return colon === -1 ? null : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Locked: APP_PASSWORD is not configured for this deployment.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  const supplied = passwordFrom(request.headers.get("authorization"));
  if (supplied !== null && safeEqual(supplied, expected)) return NextResponse.next();

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Freshroots Operations Hub", charset="UTF-8"',
      "cache-control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ingest|api/cron).*)"],
};
