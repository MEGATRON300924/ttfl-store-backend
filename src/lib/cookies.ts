import type { Response } from "express";
import { env } from "@/config/env";

export const ACCESS_COOKIE = "ttfl_access";
export const REFRESH_COOKIE = "ttfl_refresh";

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    // Cross-site cookies (frontend on Vercel, API on Render) need
    // SameSite=None + Secure. Same-site deployments can use Lax.
    sameSite: env.cookies.crossSite ? ("none" as const) : ("lax" as const),
    domain: env.cookies.domain,
    path: "/",
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: 15 * 60 * 1000, // 15 minutes, mirrors access token TTL
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    maxAge: env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, baseCookieOptions());
  res.clearCookie(REFRESH_COOKIE, baseCookieOptions());
}
