import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken, type AccessTokenPayload } from "@/lib/jwt";
import { ACCESS_COOKIE } from "@/lib/cookies";
import { AppError } from "@/utils/app-error";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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

/** Populates req.user if a valid access token is present; never throws. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // expired/invalid token — treated as anonymous, downstream guards decide
    }
  }
  next();
}

/** Rejects the request unless a valid, non-expired access token is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(AppError.unauthorized());
  }
  next();
}

/** Rejects unless the authenticated user has one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden("Your account type can't access this"));
    }
    next();
  };
}

/** Rejects unless the user has verified their email. */
export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());
  if (!req.user.emailVerified) {
    return next(AppError.forbidden("Please verify your email first", "EMAIL_NOT_VERIFIED"));
  }
  next();
}
