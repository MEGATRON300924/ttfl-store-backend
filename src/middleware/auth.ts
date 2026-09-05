import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken, type AccessTokenPayload } from "@/lib/jwt";
import { ACCESS_COOKIE } from "@/lib/cookies";
import { AppError } from "@/utils/app-error";
import { prisma } from "@/lib/prisma";
import { hasVendorPermission, type VendorPermission } from "@/lib/vendor-access";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

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
    try {
      req.user = verifyAccessToken(token);
    } catch {}
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());
  next();
}

function vendorPermissionForRequest(req: Request): VendorPermission | null {
  const path = req.originalUrl.split("?")[0];
  if (path.startsWith("/api/analytics")) return "FINANCE";
  if (path.startsWith("/api/payouts")) return "FINANCE";
  if (path.startsWith("/api/orders/vendor")) return "ORDERS";
  if (path.startsWith("/api/tracking/vendor")) return "ORDERS";
  if (path.startsWith("/api/products")) return "PRODUCTS";
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
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (roles.includes(req.user.role)) return next();
    if (!roles.includes("VENDOR")) return next(AppError.forbidden("Your account type can't access this"));

    void isActiveVendorStaff(req.user.sub).then((staff) => {
      if (!staff) return next(AppError.forbidden("Your account type can't access this"));
      const permission = vendorPermissionForRequest(req);
      const permissions = Array.isArray(staff.permissions) ? staff.permissions.filter((value): value is VendorPermission => typeof value === "string") : [];
      if (!hasVendorPermission({ isOwner: false, permissions }, permission ?? "MANAGER")) {
        return next(AppError.forbidden("You do not have permission to access this area"));
      }
      next();
    }).catch(next);
  };
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());
  if (!req.user.emailVerified) return next(AppError.forbidden("Please verify your email first", "EMAIL_NOT_VERIFIED"));
  next();
}
