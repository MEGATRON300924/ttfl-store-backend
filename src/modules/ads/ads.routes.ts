import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import * as ads from "./ads.service";
import { getCampaignAnalyticsSeries } from "./ads.analytics.service";

export const adsRouter = Router();

adsRouter.get("/plans", asyncHandler(async (_req,res)=>{ res.json({ plans: await ads.getAdPlans() }); }));
adsRouter.get("/campaigns", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>{ res.json({ campaigns: await ads.listMyCampaigns(req.user!.sub) }); }));
const campaignSchema=z.object({ name:z.string().trim().min(2).max(100), objective:z.enum(["STORE_VISITS","PRODUCT_VIEWS","SERVICE_BOOKINGS","ORDERS","STORE_PROMOTION","SPECIAL_OFFER"]), targetType:z.enum(["STORE","PRODUCT","SERVICE","COMING_SOON"]), targetId:z.string().optional(), targetCategory:z.string().max(120).optional(), targetLocation:z.string().max(160).optional(), durationDays:z.union([z.literal(1),z.literal(7),z.literal(30),z.literal(60)]) });
adsRouter.post("/campaigns", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>{ const user=await prisma.user.findUniqueOrThrow({where:{id:req.user!.sub},select:{email:true}}); res.status(201).json(await ads.createCampaign(req.user!.sub,user.email,campaignSchema.parse(req.body))); }));
adsRouter.get("/campaigns/:reference/verify", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>{ res.json({ campaign: await ads.verifyCampaignPayment(req.user!.sub,req.params.reference) }); }));
adsRouter.get("/campaigns/:id/analytics", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>{ res.json(await ads.getCampaignAnalytics(req.user!.sub,req.params.id)); }));
adsRouter.get("/campaigns/:id/analytics/series", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>{ const range=z.enum(["24h","7d","30d"]).parse(String(req.query.range??"24h")); res.json({ range, series: await getCampaignAnalyticsSeries(req.user!.sub,req.params.id,range) }); }));
adsRouter.post("/events", asyncHandler(async(req,res)=>{ const body=z.object({campaignId:z.string().min(1),eventType:z.enum(["IMPRESSION","CLICK","DESTINATION_VIEW","CHECKOUT_START","PURCHASE","BOOKING"]),visitorKey:z.string().max(200).optional(),metadata:z.record(z.any()).optional()}).parse(req.body); res.json(await ads.recordEvent(body.campaignId,body.eventType,body.visitorKey,body.metadata)); }));
adsRouter.get("/active", asyncHandler(async(req,res)=>{ res.json({ campaigns: await ads.getActiveCampaignsForPlacement(String(req.query.targetType??""),String(req.query.category??""),String(req.query.location??"")) }); }));
