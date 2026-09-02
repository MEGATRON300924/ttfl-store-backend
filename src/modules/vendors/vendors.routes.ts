import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";

import * as vendorsService from "./vendors.service";

export const vendorsRouter = Router();

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

vendorsRouter.get(
  "/store/:slug",
  asyncHandler(async (req, res) => {
    const profile = await vendorsService.getPublicVendorBySlug(req.params.slug);

    res.json({ vendorProfile: profile });
  })
);

// ---------------------------------------------------------------------------
// Vendor self-service
// ---------------------------------------------------------------------------

vendorsRouter.get(
  "/me/store",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const profile = await vendorsService.getMyVendorProfile(req.user!.sub);

    res.json({ vendorProfile: profile });
  })
);

const updateStoreSchema = z.object({
  storeName: z.string().trim().min(2).max(100),
  bio: z.string().trim().max(1000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  whatsappNumber: z.string().trim().max(30).nullable().optional(),
});

vendorsRouter.patch(
  "/me/store",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const data = updateStoreSchema.parse(req.body);

    const profile = await vendorsService.updateMyVendorProfile(
      req.user!.sub,
      data,
      req.ip
    );

    res.json({ vendorProfile: profile });
  })
);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const statusQuerySchema = z.object({
  status: z
    .enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"])
    .optional(),
});

vendorsRouter.get(
  "/admin/applications",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = statusQuerySchema.parse(req.query);

    const applications = await vendorsService.listVendorApplications(status);

    res.json({ applications });
  })
);

vendorsRouter.post(
  "/admin/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const profile = await vendorsService.approveVendor(
      req.params.id,
      req.user!.sub,
      req.ip
    );

    res.json({ vendorProfile: profile });
  })
);

const rejectSchema = z.object({
  reason: z.string().min(3).max(500),
});

vendorsRouter.post(
  "/admin/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = rejectSchema.parse(req.body);

    const profile = await vendorsService.rejectVendor(
      req.params.id,
      req.user!.sub,
      reason,
      req.ip
    );

    res.json({ vendorProfile: profile });
  })
);

vendorsRouter.post(
  "/admin/:id/suspend",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const profile = await vendorsService.suspendVendor(
      req.params.id,
      req.user!.sub,
      req.ip
    );

    res.json({ vendorProfile: profile });
  })
);

const tierSchema = z.object({
  tier: z.enum(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]),
});

vendorsRouter.post(
  "/admin/:id/tier",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { tier } = tierSchema.parse(req.body);

    const profile = await vendorsService.changeVendorTier(
      req.params.id,
      tier,
      req.user!.sub,
      req.ip
    );

    res.json({ vendorProfile: profile });
  })
);

const commissionOverrideSchema = z.object({
  commissionRateOverride: z.number().min(0).max(100).nullable(),
});

vendorsRouter.post(
  "/admin/:id/commission-override",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { commissionRateOverride } =
      commissionOverrideSchema.parse(req.body);

    const profile = await vendorsService.setCommissionOverride(
      req.params.id,
      commissionRateOverride,
      req.user!.sub,
      req.ip
    );

    res.json({ vendorProfile: profile });
  })
);