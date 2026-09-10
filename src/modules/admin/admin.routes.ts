import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { env } from "@/config/env";
import { adminAccessGrantedEmail, sendEmail, verificationEmail } from "@/lib/email";
import { generateOpaqueToken } from "@/lib/tokens";

export const adminRouter = Router();

adminRouter.get("/waitlists", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ productId: string; name: string; slug: string; vendorName: string | null; count: bigint | number; latestJoinedAt: Date | string | null }>>(`
    SELECT p.id AS "productId", p.name, p.slug, vp."storeName" AS "vendorName",
           COUNT(a.id)::bigint AS count, MAX(a.created_at) AS "latestJoinedAt"
    FROM products p
    LEFT JOIN vendor_profiles vp ON vp.id=p."vendorId"
    LEFT JOIN product_alerts a ON a.product_id=p.id AND a.type='WAITLIST'
    WHERE p."deletedAt" IS NULL AND p."comingSoon"=true
    GROUP BY p.id,p.name,p.slug,vp."storeName"
    ORDER BY COUNT(a.id) DESC, p."createdAt" DESC
  `);
  const waitlists = rows.map((row) => ({ ...row, count: Number(row.count) }));
  const total = waitlists.reduce((sum, row) => sum + row.count, 0);
  res.json({ total, products: waitlists });
}));

adminRouter.get("/waitlists/:productId", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({ where: { id: req.params.productId, deletedAt: null }, select: { id: true, name: true, slug: true, comingSoon: true } });
  if (!product) throw AppError.notFound("Product not found");
  const entries = await prisma.$queryRawUnsafe<Array<{ id: string; email: string | null; whatsapp: string | null; userId: string | null; createdAt: Date | string }>>(`
    SELECT id,email,whatsapp,user_id AS "userId",created_at AS "createdAt"
    FROM product_alerts WHERE product_id=$1 AND type='WAITLIST' ORDER BY created_at DESC
  `, product.id);
  res.json({ product, count: entries.length, entries });
}));

adminRouter.get("/admins", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: { not: "DELETED" } }, select: { id: true, email: true, firstName: true, lastName: true, status: true, emailVerified: true, createdAt: true, lastLoginAt: true }, orderBy: { createdAt: "asc" } });
  res.json({ admins });
}));

adminRouter.get("/users", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({ where: { status: { not: "DELETED" } }, select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, emailVerified: true, createdAt: true, lastLoginAt: true }, orderBy: { createdAt: "desc" } });
  const verified = users.filter((user) => user.emailVerified).length;
  res.json({ stats: { total: users.length, verified, unverified: users.length - verified }, users });
}));

adminRouter.post("/users/:id/resend-verification", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, firstName: true, emailVerified: true, status: true } });
  if (!user || user.status === "DELETED") throw AppError.notFound("User not found", "ADMIN_USER_NOT_FOUND");
  if (user.emailVerified) throw AppError.badRequest("This user's email is already verified", "EMAIL_ALREADY_VERIFIED");
  if (user.status === "SUSPENDED") throw AppError.badRequest("A suspended account cannot receive a verification link", "ADMIN_USER_SUSPENDED");
  const { raw, hash } = generateOpaqueToken();
  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }),
  ]);
  const verifyUrl = `${env.appUrl.replace(/\/$/, "")}/verify-email?token=${raw}`;
  const notification = verificationEmail(user.firstName, verifyUrl);
  await sendEmail({ to: user.email, subject: notification.subject, html: notification.html, event: "admin_resend_email_verification" });
  res.json({ message: `A new verification link was sent to ${user.email}.` });
}));

const addAdminSchema = z.object({ email: z.string().trim().email().max(320) });

adminRouter.post("/admins", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { email: requestedEmail } = addAdminSchema.parse(req.body);
  const normalizedEmail = requestedEmail.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw AppError.notFound("No TTFL Store account exists with that email", "ADMIN_USER_NOT_FOUND");
  if (user.status === "DELETED") throw AppError.badRequest("That account has been deleted", "ADMIN_USER_DELETED");
  if (user.status === "SUSPENDED") throw AppError.badRequest("That account is suspended and cannot be made an admin", "ADMIN_USER_SUSPENDED");
  if (user.role === "ADMIN") throw AppError.conflict("That user is already an admin", "ALREADY_ADMIN");

  const updated = await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" }, select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, emailVerified: true, createdAt: true, lastLoginAt: true } });
  const adminUrl = `${env.appUrl.replace(/\/$/, "")}/admin`;
  const notification = adminAccessGrantedEmail([updated.firstName, updated.lastName].filter(Boolean).join(" "), updated.email, adminUrl);
  void sendEmail({ to: updated.email, subject: notification.subject, html: notification.html, event: notification.event }).catch((error) => console.error("Failed to queue admin access notification:", error));
  res.status(201).json({ admin: updated });
}));

adminRouter.delete("/admins/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const requesterId = req.user!.sub;
  if (req.params.id === requesterId) throw AppError.badRequest("You cannot remove your own administrator access", "CANNOT_REMOVE_SELF");

  const admin = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true } });
  if (!admin || admin.status === "DELETED") throw AppError.notFound("Administrator not found", "ADMIN_NOT_FOUND");
  if (admin.role !== "ADMIN") throw AppError.badRequest("That user is not an administrator", "NOT_ADMIN");

  const updated = await prisma.user.update({ where: { id: admin.id }, data: { role: "CUSTOMER" }, select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, emailVerified: true, createdAt: true, lastLoginAt: true } });
  res.json({ admin: updated, message: `${admin.email} is no longer an administrator.` });
}));
