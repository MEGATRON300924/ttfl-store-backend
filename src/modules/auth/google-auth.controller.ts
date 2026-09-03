import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { setAuthCookies } from "@/lib/cookies";
import { AppError } from "@/utils/app-error";
import { getGoogleClientId, loginWithGoogle } from "./google-auth.service";

export const googleConfig = asyncHandler(async (_req: Request, res: Response) => {
  const clientId = await getGoogleClientId();
  res.json({ clientId });
});

export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const credential = typeof req.body?.credential === "string" ? req.body.credential : "";
  if (!credential) throw AppError.badRequest("Google credential is required", "GOOGLE_CREDENTIAL_REQUIRED");
  const result = await loginWithGoogle(credential, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ user: result.user });
});
