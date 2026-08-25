import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/tokens";
import { signAccessToken } from "@/lib/jwt";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { slugify } from "@/utils/slugify";
import {
  sendEmail,
  verificationEmail,
  passwordResetEmail,
  vendorApplicationReceivedEmail,
  adminNewVendorEmail,
} from "@/lib/email";
import { sendWhatsAppNotification, newVendorApplicationWhatsAppMessage } from "@/lib/whatsapp-notifications";
import type { RegisterCustomerInput, RegisterVendorInput, LoginInput } from "./auth.validators";
import type { Role, User } from "@prisma/client";

const REFRESH_TTL_MS = env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function publicUser(user: User) {
  const { passwordHash, ...safe } = user;
  return safe;
}

async function issueSession(
  user: User,
  meta: { userAgent?: string; ipAddress?: string }
) {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    emailVerified: user.emailVerified,
  });

  const { raw: refreshToken, hash: refreshTokenHash } = generateOpaqueToken();

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  return { accessToken, refreshToken };
}

async function sendVerificationEmail(user: User) {
  const { raw, hash } = generateOpaqueToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    },
  });
  const verifyUrl = `${env.appUrl}/verify-email?token=${raw}`;
  const { subject, html } = verificationEmail(user.firstName, verifyUrl);
  // fire-and-forget — do not block the request on email delivery
  void sendEmail({ to: user.email, subject, html });
}

export async function registerCustomer(
  input: RegisterCustomerInput,
  meta: { userAgent?: string; ipAddress?: string }
) {
  return registerUser(input, "CUSTOMER", meta);
}

export async function registerVendor(
  input: RegisterVendorInput,
  meta: { userAgent?: string; ipAddress?: string }
) {
  const user = await registerUser(input, "VENDOR", meta, async (createdUser) => {
    const baseSlug = slugify(input.storeName);
    let slug = baseSlug;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await prisma.vendorProfile.findUnique({ where: { storeSlug: slug } });
      if (!existing) break;
      slug = `${baseSlug}-${++suffix}`;
    }

    await prisma.vendorProfile.create({
      data: {
        userId: createdUser.id,
        storeName: input.storeName,
        storeSlug: slug,
        whatsappNumber: input.whatsappNumber,
        location: input.location,
      },
    });

    void sendEmail({
      to: createdUser.email,
      ...vendorApplicationReceivedEmail(input.storeName),
    });

    if (env.adminNotificationEmail) {
      void sendEmail({
        to: env.adminNotificationEmail,
        ...adminNewVendorEmail(input.storeName),
      });
    }
    if (env.whatsapp.adminNumber) {
      void sendWhatsAppNotification({
        to: env.whatsapp.adminNumber,
        message: newVendorApplicationWhatsAppMessage(input.storeName),
        event: "admin_new_vendor",
      });
    }
  });

  return user;
}

async function registerUser(
  input: RegisterCustomerInput,
  role: Role,
  meta: { userAgent?: string; ipAddress?: string },
  afterCreate?: (user: User) => Promise<void>
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict("An account with this email already exists", "EMAIL_TAKEN");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    },
  });

  if (afterCreate) await afterCreate(user);
  await sendVerificationEmail(user);

  const { accessToken, refreshToken } = await issueSession(user, meta);

  return { user: publicUser(user), accessToken, refreshToken };
}

export async function login(
  input: LoginInput,
  meta: { userAgent?: string; ipAddress?: string }
) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same error for "no such user" and "wrong password" — avoids leaking
  // which emails are registered.
  const invalidCreds = () =>
    AppError.unauthorized("Incorrect email or password", "INVALID_CREDENTIALS");

  if (!user || user.status === "DELETED") throw invalidCreds();
  const validPassword = await verifyPassword(user.passwordHash, input.password);
  if (!validPassword) throw invalidCreds();

  if (user.status === "SUSPENDED") {
    throw AppError.forbidden("This account has been suspended", "ACCOUNT_SUSPENDED");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { accessToken, refreshToken } = await issueSession(user, meta);
  return { user: publicUser(user), accessToken, refreshToken };
}

export async function refreshSession(
  refreshToken: string,
  meta: { userAgent?: string; ipAddress?: string }
) {
  const hash = hashOpaqueToken(refreshToken);
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: true },
  });

  if (!session || session.revoked || session.expiresAt < new Date()) {
    throw AppError.unauthorized("Session expired, please log in again", "SESSION_EXPIRED");
  }

  // Rotate: revoke the used refresh token and issue a brand new pair.
  // Prevents a stolen (but already-used) refresh token from being replayed.
  await prisma.session.update({
    where: { id: session.id },
    data: { revoked: true, revokedAt: new Date() },
  });

  const { accessToken, refreshToken: newRefreshToken } = await issueSession(session.user, meta);
  return { user: publicUser(session.user), accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  const hash = hashOpaqueToken(refreshToken);
  await prisma.session
    .updateMany({
      where: { refreshTokenHash: hash, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    })
    .catch(() => undefined);
}

export async function verifyEmail(token: string) {
  const hash = hashOpaqueToken(token);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw AppError.badRequest("This verification link is invalid or has expired", "INVALID_TOKEN");
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    }),
  ]);
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always respond as if it worked — don't leak whether the email exists.
  if (!user) return;

  const { raw, hash } = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${env.appUrl}/reset-password?token=${raw}`;
  const { subject, html, event } = passwordResetEmail(user.firstName, resetUrl);
  void sendEmail({ to: user.email, subject, html, event });
}

export async function resetPassword(token: string, newPassword: string) {
  const hash = hashOpaqueToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw AppError.badRequest("This reset link is invalid or has expired", "INVALID_TOKEN");
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    // Reset = assume compromise; kill every existing session.
    prisma.session.updateMany({
      where: { userId: record.userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    }),
  ]);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw AppError.badRequest("Current password is incorrect", "INVALID_CURRENT_PASSWORD");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    }),
  ]);
}

export async function deleteAccount(userId: string) {
  // Soft delete — preserves order/audit history integrity elsewhere in the
  // schema. Email is namespaced so the address can be reused for a new
  // account.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        email: `deleted+${userId}@ttflstore.invalid`,
      },
    }),
    prisma.session.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    }),
  ]);
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vendorProfile: true },
  });
  if (!user) throw AppError.notFound("User not found");
  return publicUser(user);
}
