import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import * as couponsService from "./coupons.service";

export const couponsRouter = Router();

// Lets the cart page show "Coupon applied: -₦X" before checkout, without
// duplicating the discount math — same validateCoupon function checkout
// itself calls, so the preview can never drift from what actually charges.
const previewSchema = z.object({
  code: z.string().min(1),
  lines: z.array(z.object({ vendorId: z.string(), categoryId: z.string(), lineTotal: z.number() })),
});

couponsRouter.post(
  "/preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code, lines } = previewSchema.parse(req.body);
    const result = await couponsService.validateCoupon(code, req.user!.sub, lines);
    res.json(result);
  })
);

const adminCreateSchema = z.object({
  code: z.string().min(3).max(30),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.number().positive(),
  vendorId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  minOrderAmount: z.number().positive().optional(),
  maxDiscountAmount: z.number().positive().optional(),
  usageLimit: z.number().int().positive().optional(),
  usageLimitPerUser: z.number().int().positive().optional(),
  firstOrderOnly: z.boolean().optional(),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

couponsRouter.post(
  "/admin",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const input = adminCreateSchema.parse(req.body);
    const coupon = await couponsService.adminCreateCoupon(input, req.user!.sub);
    res.status(201).json({ coupon });
  })
);

couponsRouter.get(
  "/admin",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const coupons = await couponsService.adminListCoupons();
    res.json({ coupons });
  })
);

const adminUpdateSchema = z.object({
  active: z.boolean().optional(),
  expiresAt: z.coerce.date().optional(),
  usageLimit: z.number().int().positive().optional(),
});

couponsRouter.patch(
  "/admin/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const input = adminUpdateSchema.parse(req.body);
    const coupon = await couponsService.adminUpdateCoupon(req.params.id, input, req.user!.sub);
    res.json({ coupon });
  })
);

const vendorCreateSchema = z.object({
  code: z.string().min(3).max(30),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.number().positive(),
  minOrderAmount: z.number().positive().optional(),
  maxDiscountAmount: z.number().positive().optional(),
  usageLimit: z.number().int().positive().optional(),
  usageLimitPerUser: z.number().int().positive().optional(),
  expiresAt: z.coerce.date().optional(),
});

couponsRouter.post(
  "/vendor",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const input = vendorCreateSchema.parse(req.body);
    const coupon = await couponsService.vendorCreateCoupon(vendor.id, input);
    res.status(201).json({ coupon });
  })
);

couponsRouter.get(
  "/vendor",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const coupons = await couponsService.vendorListCoupons(vendor.id);
    res.json({ coupons });
  })
);
