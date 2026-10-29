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


const blackFridaySchema = z.object({
  enabled: z.boolean(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  headline: z.string().trim().min(5).max(100),
  subheadline: z.string().trim().min(5).max(220),
  discountMode: z.enum(["vendor", "admin", "vendor-approval"]),
  participation: z.enum(["both", "vendors", "ttfl"]),
}).refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
  message: "Campaign end time must be after its start time",
  path: ["endsAt"],
});

// Public endpoint exposes only campaign display settings, never private platform settings.
settingsRouter.get("/black-friday/public", asyncHandler(async (_req, res) => {
  const config = await settingsService.getBlackFridayConfig();
  const now = Date.now();
  const scheduled = now >= new Date(config.startsAt).getTime() && now < new Date(config.endsAt).getTime();
  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
  res.json({ campaign: config, isLive: config.enabled && scheduled, isScheduled: config.enabled && now < new Date(config.startsAt).getTime() });
}));

settingsRouter.get("/black-friday", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  res.json({ campaign: await settingsService.getBlackFridayConfig() });
}));

settingsRouter.put("/black-friday", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const config = blackFridaySchema.parse(req.body);
  res.json({ campaign: await settingsService.saveBlackFridayConfig(config) });
}));

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
