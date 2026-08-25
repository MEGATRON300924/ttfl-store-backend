import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as vendorPlansService from "./vendor-plans.service";

export const vendorPlansRouter = Router();

// Public — pricing page needs this without auth
vendorPlansRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const plans = await vendorPlansService.listPlans();
    res.json({ plans });
  })
);

const upsertSchema = z.object({
  name: z.string().min(2).max(80),
  price: z.number().nonnegative(),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  productLimit: z.number().int().positive().nullable(),
  commissionRate: z.number().min(0).max(100),
  features: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

vendorPlansRouter.put(
  "/:tier",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const tier = req.params.tier as "FREE" | "PRO" | "BUSINESS" | "ENTERPRISE";
    if (!["FREE", "PRO", "BUSINESS", "ENTERPRISE"].includes(tier)) {
      return res.status(400).json({ error: { code: "INVALID_TIER", message: "Unknown tier" } });
    }
    const input = upsertSchema.parse(req.body);
    const plan = await vendorPlansService.upsertPlan(tier, input, req.user!.sub);
    res.json({ plan });
  })
);
