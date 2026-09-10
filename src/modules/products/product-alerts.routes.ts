import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { attachUser } from "@/middleware/auth";
import * as service from "./product-alerts.service";

export const productAlertsRouter = Router();
productAlertsRouter.use(attachUser);
const schema = z.object({ type: z.enum(["BACK_IN_STOCK", "PRICE_DROP"]), email: z.string().email().optional(), whatsapp: z.string().min(7).max(20).optional(), targetPrice: z.coerce.number().positive().optional() });
const waitlistSchema = z.object({ email: z.string().email().optional(), whatsapp: z.string().min(7).max(20).optional() });

productAlertsRouter.get("/:productId/waitlist", asyncHandler(async (req, res) => {
  res.json(await service.getWaitlistCount(req.params.productId));
}));

productAlertsRouter.post("/:productId/waitlist", asyncHandler(async (req, res) => {
  const input = waitlistSchema.parse(req.body);
  res.status(201).json(await service.joinWaitlist(req.params.productId, input, req.user?.sub));
}));

productAlertsRouter.post("/:productId", asyncHandler(async (req, res) => { const input = schema.parse(req.body); res.status(201).json(await service.createAlert(req.params.productId, input, req.user?.sub)); }));
productAlertsRouter.delete("/:alertId", asyncHandler(async (req, res) => { res.json(await service.removeAlert(req.params.alertId, req.user?.sub)); }));
