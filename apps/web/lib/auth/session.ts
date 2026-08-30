import { NextResponse } from "next/server";
import { verifyJWT } from "@repo/auth-utils/jwt";
import { JwtPayLoad } from "@repo/types/authTypes";

const JWT_SECRET = process.env.JWT_SECRET as string;
const COOKIE_MAX_AGE_SECONDS = 60 * 60;

/**
 * Sets the session cookie with the same flags everywhere it's issued
 * (previously login/register/auth.service each set slightly different
 * flags). `secure` follows NODE_ENV rather than being hardcoded false, so
 * the cookie is actually marked secure in production.
 */
export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: "token",
    value: token,
    httpOnly: true,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function extractToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const tokenPair = cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith("token="));
  return tokenPair ? tokenPair.slice("token=".length) : null;
}

/**
 * Verifies the session cookie on a plain Request (route handlers that need
 * the raw Request, e.g. because they also read req.json()). Returns null on
 * any failure to authenticate rather than throwing, so callers can respond
 * with a single 401 branch.
 */
export async function requireUser(req: Request): Promise<JwtPayLoad | null> {
  const token = extractToken(req.headers.get("cookie"));
  if (!token) return null;
  return verifyJWT(token, JWT_SECRET);
}
