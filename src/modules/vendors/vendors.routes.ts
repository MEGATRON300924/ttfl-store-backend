import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { prisma } from "@/lib/prisma";
import * as vendorsService from "./vendors.service";

export const vendorsRouter = Router();

vendorsRouter.get("/stores", asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(48, Math.max(1, Number(req.query.limit ?? 24)));
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const result = await vendorsService.listPublicVendors({ page, limit, q });
  res.json(result);
}));

vendorsRouter.get("/store/:slug", asyncHandler(async (req, res) => {
  const profile = await vendorsService.getPublicVendorBySlug(req.params.slug);
  res.json({ vendorProfile: profile });
}));

vendorsRouter.get("/me/store", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const profile = await vendorsService.getMyVendorProfile(req.user!.sub);
  res.json({ vendorProfile: profile });
}));

const updateStoreSchema = z.object({
  storeName: z.string().trim().min(2).max(100),
  storeSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  bio: z.string().trim().max(1000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  whatsappNumber: z.string().trim().max(30).nullable().optional(),
});

vendorsRouter.patch("/me/store", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const data = updateStoreSchema.parse(req.body);
  const profile = await vendorsService.updateMyVendorProfile(req.user!.sub, data, req.ip);
  res.json({ vendorProfile: profile });
}));



async function ensureVendorBookingSettings() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS vendor_booking_settings (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      booking_url TEXT,
      booking_label TEXT,
      whatsapp_number TEXT,
      phone_number TEXT,
      email TEXT,
      instructions TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

const bookingSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  bookingUrl: z.string().trim().url().max(1000).nullable().optional(),
  bookingLabel: z.string().trim().max(80).nullable().optional(),
  whatsappNumber: z.string().trim().max(30).nullable().optional(),
  phoneNumber: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  instructions: z.string().trim().max(1000).nullable().optional(),
});

vendorsRouter.get("/me/booking-settings", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  await ensureVendorBookingSettings();
  const vendor = await vendorsService.getMyVendorProfile(req.user!.sub);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT enabled, booking_url AS "bookingUrl", booking_label AS "bookingLabel",
      whatsapp_number AS "whatsappNumber", phone_number AS "phoneNumber",
      email, instructions, updated_at AS "updatedAt"
     FROM vendor_booking_settings WHERE vendor_id = $1 LIMIT 1`,
    vendor.id,
  );
  res.json({ bookingSettings: rows[0] ?? {
    enabled: false, bookingUrl: null, bookingLabel: "Book an appointment",
    whatsappNumber: vendor.whatsappNumber ?? null, phoneNumber: null,
    email: null, instructions: null,
  } });
}));

vendorsRouter.put("/me/booking-settings", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  await ensureVendorBookingSettings();
  const data = bookingSettingsSchema.parse(req.body);
  const vendor = await vendorsService.getMyVendorProfile(req.user!.sub);
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM vendor_booking_settings WHERE vendor_id = $1 LIMIT 1`, vendor.id,
  );
  const values = [
    data.enabled,
    data.bookingUrl?.trim() || null,
    data.bookingLabel?.trim() || null,
    data.whatsappNumber?.trim() || null,
    data.phoneNumber?.trim() || null,
    data.email?.trim() || null,
    data.instructions?.trim() || null,
    vendor.id,
  ];
  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE vendor_booking_settings
       SET enabled=$1, booking_url=$2, booking_label=$3, whatsapp_number=$4,
           phone_number=$5, email=$6, instructions=$7, updated_at=NOW()
       WHERE vendor_id=$8`,
      ...values,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO vendor_booking_settings
       (id,vendor_id,enabled,booking_url,booking_label,whatsapp_number,phone_number,email,instructions)
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8)`,
      vendor.id, ...values.slice(0, 7),
    );
  }
  res.json({ message: "Booking settings saved.", bookingSettings: {
    enabled: data.enabled,
    bookingUrl: data.bookingUrl?.trim() || null,
    bookingLabel: data.bookingLabel?.trim() || null,
    whatsappNumber: data.whatsappNumber?.trim() || null,
    phoneNumber: data.phoneNumber?.trim() || null,
    email: data.email?.trim() || null,
    instructions: data.instructions?.trim() || null,
  }});
}));

const statusQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional() });

vendorsRouter.get("/admin/applications", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { status } = statusQuerySchema.parse(req.query);
  const applications = await vendorsService.listVendorApplications(status);
  res.json({ applications });
}));

vendorsRouter.post("/admin/:id/approve", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const profile = await vendorsService.approveVendor(req.params.id, req.user!.sub, req.ip);
  res.json({ vendorProfile: profile });
}));

const rejectSchema = z.object({ reason: z.string().min(3).max(500) });
vendorsRouter.post("/admin/:id/reject", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { reason } = rejectSchema.parse(req.body);
  const profile = await vendorsService.rejectVendor(req.params.id, req.user!.sub, reason, req.ip);
  res.json({ vendorProfile: profile });
}));

vendorsRouter.post("/admin/:id/suspend", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const profile = await vendorsService.suspendVendor(req.params.id, req.user!.sub, req.ip);
  res.json({ vendorProfile: profile });
}));

const tierSchema = z.object({ tier: z.enum(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]) });
vendorsRouter.post("/admin/:id/tier", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { tier } = tierSchema.parse(req.body);
  const profile = await vendorsService.changeVendorTier(req.params.id, tier, req.user!.sub, req.ip);
  res.json({ vendorProfile: profile });
}));

const grantSubscriptionSchema = z.object({
  tier: z.enum(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]),
  lifetime: z.boolean().default(false),
});
vendorsRouter.post("/admin/:id/grant-subscription", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { tier, lifetime } = grantSubscriptionSchema.parse(req.body);
  const result = await vendorsService.grantVendorSubscription(req.params.id, tier, lifetime, req.user!.sub, req.ip);
  res.json({ vendorProfile: result.profile, subscription: result.subscription, paymentRequired: false });
}));

const commissionOverrideSchema = z.object({ commissionRateOverride: z.number().min(0).max(100).nullable() });
vendorsRouter.post("/admin/:id/commission-override", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { commissionRateOverride } = commissionOverrideSchema.parse(req.body);
  const profile = await vendorsService.setCommissionOverride(req.params.id, commissionRateOverride, req.user!.sub, req.ip);
  res.json({ vendorProfile: profile });
}));

export default vendorsRouter;
