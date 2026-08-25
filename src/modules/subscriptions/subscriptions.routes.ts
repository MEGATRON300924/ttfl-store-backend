import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import * as subscriptionsService from "./subscriptions.service";

export const subscriptionsRouter = Router();

subscriptionsRouter.get(
  "/me",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const subscription = await subscriptionsService.getMySubscription(vendor.id);
    res.json({ subscription });
  })
);

const changeSchema = z.object({ tier: z.enum(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]) });

subscriptionsRouter.post(
  "/change",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const { tier } = changeSchema.parse(req.body);
    const [vendor, user] = await Promise.all([
      prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } }),
      prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }),
    ]);
    const result = await subscriptionsService.initiatePlanChange(vendor.id, user.email, tier);
    res.json(result);
  })
);

subscriptionsRouter.get(
  "/verify/:reference",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionsService.verifyAndActivateSubscription(req.params.reference);
    res.json({ subscription });
  })
);

subscriptionsRouter.post(
  "/cancel",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const result = await subscriptionsService.cancelSubscription(vendor.id);
    res.json(result);
  })
);
