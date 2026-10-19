import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as settingsService from "./settings.service";

export const settingsRouter = Router();

// Public checkout quote: expose only the delivery fee, never private platform settings.
settingsRouter.get("/shipping-fee", asyncHandler(async (_req, res) => {
  const fee = await settingsService.getSettingNumber("delivery_fee");
  res.json({ deliveryFee: Number.isFinite(fee) ? Math.max(0, fee) : 0, currency: "NGN" });
}));

settingsRouter.get(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const settings = await settingsService.getAllSettings();
    res.json({ settings });
  })
);

const updateSchema = z.object({ value: z.string().min(1).max(200) });

settingsRouter.put(
  "/:key",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { value } = updateSchema.parse(req.body);
    const setting = await settingsService.setSetting(req.params.key, value);
    res.json({ setting });
  })
);
