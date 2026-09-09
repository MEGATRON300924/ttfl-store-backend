import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { recordEvent, vendorReport } from "./promotion-analytics.service";
export const promotionAnalyticsRouter = Router();
promotionAnalyticsRouter.post("/event", asyncHandler(async (req,res) => { const input=z.object({promotionType:z.string().max(40),promotionId:z.string().max(100),vendorId:z.string().max(100),productId:z.string().max(100).optional(),event:z.string().max(40),sessionId:z.string().max(200).optional(),userId:z.string().max(100).optional(),quantity:z.number().int().positive().optional(),revenue:z.number().nonnegative().optional(),source:z.string().max(100).optional()}).parse(req.body); res.status(201).json(await recordEvent(input)); }));
promotionAnalyticsRouter.get("/mine", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>res.json(await vendorReport(req.user!.sub))));
