import type { Response } from "express";
import { env } from "@/config/env";

export const ACCESS_COOKIE = "ttfl_access";
export const REFRESH_COOKIE = "ttfl_refresh";

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    // The storefront and Render API are different origins/sites, so production
    // authentication must use SameSite=None. Host-only cookies are intentional:
    // COOKIE_DOMAIN can otherwise make browsers reject a cookie set by Render.
    sameSite: env.isProd || env.cookies.crossSite ? ("none" as const) : ("lax" as const),
    path: "/",
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const accessTtlMs = 15 * 60 * 1000;
  const refreshTtlMs = Math.min(30, Math.max(1, env.jwt.refreshTtlDays)) * 24 * 60 * 60 * 1000;
  // Set both Max-Age and Expires explicitly so browsers persist the refresh
  // cookie across Chrome restarts and hard reloads instead of treating it as a session cookie.
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: accessTtlMs,
    expires: new Date(Date.now() + accessTtlMs),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    maxAge: refreshTtlMs,
    expires: new Date(Date.now() + refreshTtlMs),
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, baseCookieOptions());
  res.clearCookie(REFRESH_COOKIE, baseCookieOptions());
}
