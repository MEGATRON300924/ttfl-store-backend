import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { env } from "@/config/env";
import { adminAccessGrantedEmail, sendEmail } from "@/lib/email";

export const adminRouter = Router();

adminRouter.get(
  "/admins",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", status: { not: "DELETED" } },
      select: { id: true, email: true, firstName: true, lastName: true, status: true, emailVerified: true, createdAt: true, lastLoginAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ admins });
  })
);

const addAdminSchema = z.object({
  email: z.string().trim().email().max(320),
});

adminRouter.post(
  "/admins",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { email: requestedEmail } = addAdminSchema.parse(req.body);
    const normalizedEmail = requestedEmail.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      throw AppError.notFound("No TTFL Store account exists with that email", "ADMIN_USER_NOT_FOUND");
    }
    if (user.status === "DELETED") {
      throw AppError.badRequest("That account has been deleted", "ADMIN_USER_DELETED");
    }
    if (user.status === "SUSPENDED") {
      throw AppError.badRequest("That account is suspended and cannot be made an admin", "ADMIN_USER_SUSPENDED");
    }
    if (user.role === "ADMIN") {
      throw AppError.conflict("That user is already an admin", "ALREADY_ADMIN");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, emailVerified: true, createdAt: true, lastLoginAt: true },
    });

    const adminUrl = `${env.appUrl.replace(/\/$/, "")}/admin`;
    const notification = adminAccessGrantedEmail(
      [updated.firstName, updated.lastName].filter(Boolean).join(" "),
      updated.email,
      adminUrl
    );

    void sendEmail({
      to: updated.email,
      subject: notification.subject,
      html: notification.html,
      event: notification.event,
    }).catch((error) => {
      console.error("Failed to queue admin access notification:", error);
    });

    res.status(201).json({ admin: updated });
  })
);
