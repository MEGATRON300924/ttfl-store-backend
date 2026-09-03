import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { generateOpaqueToken } from "@/lib/tokens";
import { signAccessToken } from "@/lib/jwt";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import type { User } from "@prisma/client";

function publicUser(user: User) {
  const { passwordHash, ...safe } = user;
  return safe;
}

async function issueSession(user: User, meta: { userAgent?: string; ipAddress?: string }) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, emailVerified: user.emailVerified });
  const { raw: refreshToken, hash: refreshTokenHash } = generateOpaqueToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: new Date(Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken };
}

type GoogleToken = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  given_name?: string;
  family_name?: string;
  name?: string;
};

export async function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID ?? null;
}

export async function loginWithGoogle(credential: string, meta: { userAgent?: string; ipAddress?: string }) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw AppError.internal("Google Sign-In is not configured", "GOOGLE_NOT_CONFIGURED");
  if (!credential || credential.length > 10000) throw AppError.badRequest("Invalid Google credential", "INVALID_GOOGLE_CREDENTIAL");

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!response.ok) throw AppError.unauthorized("Google Sign-In could not be verified", "INVALID_GOOGLE_CREDENTIAL");

  const token = (await response.json()) as GoogleToken;
  const email = token.email?.trim().toLowerCase();
  const verified = token.email_verified === true || token.email_verified === "true";
  if (!token.sub || !email || !verified || token.aud !== clientId) {
    throw AppError.unauthorized("Google account could not be verified", "INVALID_GOOGLE_CREDENTIAL");
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (user?.status === "DELETED") throw AppError.unauthorized("This account is no longer available", "ACCOUNT_DELETED");
  if (user?.status === "SUSPENDED") throw AppError.forbidden("This account has been suspended", "ACCOUNT_SUSPENDED");

  if (!user) {
    const firstName = (token.given_name?.trim() || token.name?.trim().split(/\s+/)[0] || "TTFL").slice(0, 80);
    const lastName = (token.family_name?.trim() || token.name?.trim().split(/\s+/).slice(1).join(" ") || "Customer").slice(0, 80);
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(`${randomBytes(48).toString("hex")}Aa1`),
        role: "CUSTOMER",
        firstName,
        lastName,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifiedAt: user.emailVerifiedAt ?? new Date(), lastLoginAt: new Date() },
    });
  }

  const { accessToken, refreshToken } = await issueSession(user, meta);
  return { user: publicUser(user), accessToken, refreshToken };
}
