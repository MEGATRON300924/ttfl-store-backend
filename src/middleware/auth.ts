import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken, type AccessTokenPayload } from "@/lib/jwt";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies } from "@/lib/cookies";
import { hashOpaqueToken } from "@/lib/tokens";
import { AppError } from "@/utils/app-error";
import { prisma } from "@/lib/prisma";
import { hasVendorPermission, type VendorPermission } from "@/lib/vendor-access";

declare global { namespace Express { interface Request { user?: AccessTokenPayload; } } }

const INACTIVITY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try { req.user = verifyAccessToken(token); } catch {}
  }
  next();
}

async function validateCookieSession(req: Request, res: Response) {
  // Browser sessions use HttpOnly cookies. Bearer-token clients (such as mobile
  // apps) retain their existing authentication flow.
  if (!req.cookies?.[ACCESS_COOKIE]) return;
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!rawRefreshToken) {
    clearAuthCookies(res);
    throw AppError.unauthorized("Your session has expired. Please sign in again.", "SESSION_EXPIRED");
  }

  const refreshTokenHash = hashOpaqueToken(rawRefreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash } });
  const now = new Date();
  if (!session || session.revoked || session.expiresAt <= now) {
    clearAuthCookies(res);
    throw AppError.unauthorized("Your session has expired. Please sign in again.", "SESSION_EXPIRED");
  }

  if (session.lastActivityAt.getTime() <= now.getTime() - INACTIVITY_TTL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { revoked: true, revokedAt: now } });
    clearAuthCookies(res);
    throw AppError.unauthorized("You were signed out after 14 days of inactivity. Please sign in again.", "SESSION_INACTIVE");
  }

  await prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: now } });
}

async function getCurrentRole(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());
  void (async () => {
    await validateCookieSession(req, res);
    const currentUser = await getCurrentRole(req.user!.sub);
    if (!currentUser || currentUser.status === "DELETED") return next(AppError.unauthorized());
    if (currentUser.status === "SUSPENDED") return next(AppError.forbidden("This account has been disabled", "ACCOUNT_DISABLED"));
    next();
  })().catch(next);
}

function vendorPermissionForRequest(req: Request): VendorPermission | null {
  const path = req.originalUrl.split("?")[0];
  if (path.startsWith("/api/analytics")) return "FINANCE";
  if (path.startsWith("/api/payouts")) return "FINANCE";
  if (path.startsWith("/api/orders/vendor")) return "ORDERS";
  if (path.startsWith("/api/tracking/vendor")) return "ORDERS";
  if (path.startsWith("/api/products")) return "PRODUCTS";
  if (path.startsWith("/api/flash-deals")) return "PRODUCTS";
  if (path.startsWith("/api/launch-campaigns")) return "PRODUCTS";
  if (path.startsWith("/api/uploads")) return "PRODUCTS";
  if (path.startsWith("/api/featured")) return "PRODUCTS";
  if (path.startsWith("/api/coupons")) return "MANAGER";
  if (path.startsWith("/api/store-profile")) return "MANAGER";
  if (path.startsWith("/api/vendors/me")) return "MANAGER";
  if (path.startsWith("/api/subscriptions")) return "MANAGER";
  return "MANAGER";
}

async function isActiveVendorStaff(userId: string) {
  return prisma.vendorStaff.findFirst({ where: { userId, active: true }, select: { role: true, permissions: true } });
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    void (async () => {
      await validateCookieSession(req, res);
      const currentUser = await getCurrentRole(req.user!.sub);
      if (!currentUser || currentUser.status === "DELETED") return next(AppError.unauthorized());
      if (currentUser.status === "SUSPENDED") return next(AppError.forbidden("Your account is suspended", "ACCOUNT_DISABLED"));
      if (roles.includes(currentUser.role)) return next();
      if (!roles.includes("VENDOR")) return next(AppError.forbidden("Your account type can't access this"));
      const staff = await isActiveVendorStaff(req.user!.sub);
      if (!staff) return next(AppError.forbidden("Your account type can't access this"));
      const permission = vendorPermissionForRequest(req);
      const permissions = Array.isArray(staff.permissions)
        ? staff.permissions.filter((value): value is VendorPermission => typeof value === "string")
        : [];
      if (!hasVendorPermission({ isOwner: false, permissions }, permission ?? "MANAGER")) return next(AppError.forbidden("You do not have permission to access this area"));
      next();
    })().catch(next);
  };
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());
  if (!req.user.emailVerified) return next(AppError.forbidden("Please verify your email first", "EMAIL_NOT_VERIFIED"));
  next();
}
