import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./tracking.service";

export const trackingRouter = Router();

const publicSchema = z.object({ orderNumber: z.string().min(3).max(80), productId: z.string().min(3).max(120) });
const checkpointSchema = z.object({
  checkpoint: z.number().int().min(1).max(5),
  description: z.string().max(2000).optional(),
  avatar: z.enum(["motorcycle", "car", "truck", "package"]).optional(),
  trackingUrl: z.string().url().optional().or(z.literal("")),
  riderName: z.string().max(120).optional(),
  riderPhone: z.string().max(40).optional(),
});

trackingRouter.post("/public", asyncHandler(async (req, res) => {
  const input = publicSchema.parse(req.body);
  res.json(await service.trackPublic(input.orderNumber, input.productId));
}));

trackingRouter.get("/order/:orderNumber", requireAuth, asyncHandler(async (req, res) => {
  res.json(await service.trackAuthenticated(req.params.orderNumber, req.user!.sub));
}));

trackingRouter.patch("/vendor/:vendorOrderId/checkpoint", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const input = checkpointSchema.parse(req.body);
  res.json(await service.updateCheckpoint(req.user!.sub, req.params.vendorOrderId, input.checkpoint, input.description, input.avatar, input.trackingUrl, input.riderName, input.riderPhone));
}));
