import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import { sendEmail, vendorApprovedEmail, vendorRejectedEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

export async function getMyVendorProfile(userId: string) {
  const profile = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (!profile) throw AppError.notFound("Vendor profile not found");
  return profile;
}

export async function getPublicVendorBySlug(slug: string) {
  const profile = await prisma.vendorProfile.findUnique({
    where: { storeSlug: slug },
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      bio: true,
      location: true,
      verified: true,
      status: true,
      createdAt: true,
      _count: { select: { products: { where: { status: "ACTIVE", deletedAt: null } } } },
    },
  });
  if (!profile || profile.status !== "APPROVED") {
    throw AppError.notFound("Store not found");
  }

   // Fire-and-forget view counter — same pattern as Product.viewCount.
  // .catch() here matters: this fires on every storefront page view
  // (unauthenticated, high-frequency), so a bare `void` with no error
  // handling would crash the whole server on any transient DB hiccup —
  // exactly the bug class that caused the production crash loop this
  // was fixed alongside (see email-queue.ts for the fuller writeup).
  prisma.vendorProfile
    .update({ where: { id: profile.id }, data: { viewCount: { increment: 1 } } })
    .catch((err: unknown) => logger.error("Failed to increment store view count (non-fatal)", { err }));
  return profile;
}

export async function listVendorApplications(status?: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED") {
  return prisma.vendorProfile.findMany({
    where: status ? { status } : undefined,
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { appliedAt: "desc" },
  });
}

export async function approveVendor(vendorProfileId: string, adminId: string, ipAddress?: string) {
  const profile = await prisma.vendorProfile.update({
    where: { id: vendorProfileId },
    data: { status: "APPROVED", verified: true, approvedAt: new Date() },
    include: { user: true },
  });

  await recordAudit({
    actorId: adminId,
    action: "VENDOR_APPROVED",
    targetType: "VendorProfile",
    targetId: profile.id,
    ipAddress,
  });

  void sendEmail({ to: profile.user.email, ...vendorApprovedEmail(profile.storeName) });

  return profile;
}

export async function rejectVendor(
  vendorProfileId: string,
  adminId: string,
  reason: string,
  ipAddress?: string
) {
  const profile = await prisma.vendorProfile.update({
    where: { id: vendorProfileId },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason },
    include: { user: true },
  });

  await recordAudit({
    actorId: adminId,
    action: "VENDOR_REJECTED",
    targetType: "VendorProfile",
    targetId: profile.id,
    metadata: { reason },
    ipAddress,
  });

  void sendEmail({ to: profile.user.email, ...vendorRejectedEmail(profile.storeName, reason) });

  return profile;
}

export async function suspendVendor(vendorProfileId: string, adminId: string, ipAddress?: string) {
  const profile = await prisma.vendorProfile.update({
    where: { id: vendorProfileId },
    data: { status: "SUSPENDED" },
  });

  await recordAudit({
    actorId: adminId,
    action: "VENDOR_SUSPENDED",
    targetType: "VendorProfile",
    targetId: profile.id,
    ipAddress,
  });

  return profile;
}

export async function changeVendorTier(
  vendorProfileId: string,
  tier: "FREE" | "PRO" | "BUSINESS" | "ENTERPRISE",
  adminId: string,
  ipAddress?: string
) {
  const profile = await prisma.vendorProfile.update({
    where: { id: vendorProfileId },
    data: { tier },
  });

  await recordAudit({
    actorId: adminId,
    action: "VENDOR_TIER_CHANGED",
    targetType: "VendorProfile",
    targetId: profile.id,
    metadata: { newTier: tier },
    ipAddress,
  });

  return profile;
}

/** Custom commission agreement for one vendor (spec §16/§17 — "custom commission agreements" for Enterprise). Null clears the override, falling back to the vendor's plan rate. */
export async function setCommissionOverride(
  vendorProfileId: string,
  ratePercent: number | null,
  adminId: string,
  ipAddress?: string
) {
  const profile = await prisma.vendorProfile.update({
    where: { id: vendorProfileId },
    data: { commissionRateOverride: ratePercent },
  });

  await recordAudit({
    actorId: adminId,
    action: "VENDOR_TIER_CHANGED",
    targetType: "VendorProfile",
    targetId: profile.id,
    metadata: { commissionRateOverride: ratePercent },
    ipAddress,
  });

  return profile;
}
