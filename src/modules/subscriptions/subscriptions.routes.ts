import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { prisma } from "@/lib/prisma";
import * as subscriptionsService from "./subscriptions.service";

export const subscriptionsRouter = Router();
subscriptionsRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ subscription: await subscriptionsService.getMySubscription(vendor.id) }); }));
const changeSchema = z.object({ tier: z.enum(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]) });
subscriptionsRouter.post("/change", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const { tier } = changeSchema.parse(req.body); const vendor = await getVendorProfileForUser(req.user!.sub); const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }); res.json(await subscriptionsService.initiatePlanChange(vendor.id, user.email, tier)); }));
subscriptionsRouter.get("/verify/:reference", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.json({ subscription: await subscriptionsService.verifyAndActivateSubscription(req.params.reference) }); }));
subscriptionsRouter.post("/cancel", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json(await subscriptionsService.cancelSubscription(vendor.id)); }));
