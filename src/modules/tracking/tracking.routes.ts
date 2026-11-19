import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./tracking.service";
export const trackingRouter=Router();
const checkpointSchema=z.object({checkpoint:z.number().int().min(1).max(5),description:z.string().max(2000).optional(),avatar:z.enum(["motorcycle","car","truck","package"]).optional(),trackingUrl:z.string().url().optional().or(z.literal("")),riderName:z.string().max(120).optional(),riderPhone:z.string().max(40).optional()});

// Public tracking is only available through a signed, expiring token. The legacy
// orderNumber + productId endpoint was removed because those values are not a secret.
trackingRouter.get("/public/:token",asyncHandler(async(req,res)=>{res.json(await service.trackByPublicToken(req.params.token));}));
trackingRouter.get("/order/:orderNumber",requireAuth,asyncHandler(async(req,res)=>{res.json(await service.trackAuthenticated(req.params.orderNumber,req.user!.sub));}));
trackingRouter.get("/vendor/:vendorOrderId",requireAuth,requireRole("VENDOR"),asyncHandler(async(req,res)=>{res.json({vendorOrder:await service.getVendorOrderTracking(req.user!.sub,req.params.vendorOrderId)});}));
trackingRouter.patch("/vendor/:vendorOrderId/checkpoint",requireAuth,requireRole("VENDOR"),asyncHandler(async(req,res)=>{const input=checkpointSchema.parse(req.body);res.json(await service.updateCheckpoint(req.user!.sub,req.params.vendorOrderId,input.checkpoint,input.description,input.avatar,input.trackingUrl,input.riderName,input.riderPhone));}));

const ttflDriverSchema=z.object({
  riderName:z.string().trim().min(2).max(120),
  riderPhone:z.string().trim().regex(/^\+?[0-9\s()-]{7,20}$/,"Enter a valid rider phone number"),
  trackingUrl:z.string().url().max(2048).optional().or(z.literal("")),
  description:z.string().trim().max(2000).optional(),
});
trackingRouter.get("/admin/ttfl-deliveries",requireAuth,requireRole("ADMIN"),asyncHandler(async(_req,res)=>{
  res.json({deliveries:await service.listAdminTtflDeliveries()});
}));
trackingRouter.patch("/admin/:vendorOrderId/driver",requireAuth,requireRole("ADMIN"),asyncHandler(async(req,res)=>{
  const input=ttflDriverSchema.parse(req.body);
  res.json(await service.assignTtflDriver(req.params.vendorOrderId,input));
}));
