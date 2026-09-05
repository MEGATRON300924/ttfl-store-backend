import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import * as couponsService from "./coupons.service";

export const couponsRouter = Router();
const previewSchema = z.object({ code: z.string().min(1), lines: z.array(z.object({ vendorId: z.string(), categoryId: z.string(), lineTotal: z.number() })) });
couponsRouter.post("/preview", requireAuth, asyncHandler(async (req, res) => { const { code, lines } = previewSchema.parse(req.body); res.json(await couponsService.validateCoupon(code, req.user!.sub, lines)); }));
const adminCreateSchema = z.object({ code: z.string().min(3).max(30), type: z.enum(["PERCENTAGE", "FIXED"]), value: z.number().positive(), vendorId: z.string().uuid().optional(), categoryId: z.string().uuid().optional(), minOrderAmount: z.number().positive().optional(), maxDiscountAmount: z.number().positive().optional(), usageLimit: z.number().int().positive().optional(), usageLimitPerUser: z.number().int().positive().optional(), firstOrderOnly: z.boolean().optional(), startsAt: z.coerce.date().optional(), expiresAt: z.coerce.date().optional() });
couponsRouter.post("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.status(201).json({ coupon: await couponsService.adminCreateCoupon(adminCreateSchema.parse(req.body), req.user!.sub) }); }));
couponsRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => { res.json({ coupons: await couponsService.adminListCoupons() }); }));
const adminUpdateSchema = z.object({ active: z.boolean().optional(), expiresAt: z.coerce.date().optional(), usageLimit: z.number().int().positive().optional() });
couponsRouter.patch("/admin/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.json({ coupon: await couponsService.adminUpdateCoupon(req.params.id, adminUpdateSchema.parse(req.body), req.user!.sub) }); }));
const vendorCreateSchema = z.object({ code: z.string().min(3).max(30), type: z.enum(["PERCENTAGE", "FIXED"]), value: z.number().positive(), minOrderAmount: z.number().positive().optional(), maxDiscountAmount: z.number().positive().optional(), usageLimit: z.number().int().positive().optional(), usageLimitPerUser: z.number().int().positive().optional(), expiresAt: z.coerce.date().optional() });
couponsRouter.post("/vendor", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.status(201).json({ coupon: await couponsService.vendorCreateCoupon(vendor.id, vendorCreateSchema.parse(req.body)) }); }));
couponsRouter.get("/vendor", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ coupons: await couponsService.vendorListCoupons(vendor.id) }); }));
