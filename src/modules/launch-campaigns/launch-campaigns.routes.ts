import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import * as service from "./launch-campaigns.service";

export const launchCampaignsRouter=Router();
const launchDetails=z.object({price:z.coerce.number().positive().max(999999999),previousPrice:z.coerce.number().positive().max(999999999).nullable().optional(),stock:z.coerce.number().int().min(0).optional(),estimatedDeliveryDays:z.coerce.number().int().min(1).max(90).optional(),sellingMethod:z.enum(["CHECKOUT","EXTERNAL_LINK","WHATSAPP"]).optional(),externalUrl:z.string().url().nullable().optional(),whatsappNumber:z.string().min(7).max(20).nullable().optional()}).optional();
const schema=z.object({productId:z.string().min(1),launchAt:z.string().datetime(),homepage:z.boolean().optional(),flashDealId:z.string().nullable().optional(),launchDetails});
launchCampaignsRouter.use(requireAuth);
launchCampaignsRouter.get("/mine",async(req,res,next)=>{try{res.json({campaigns:await service.getMine(req.user!.sub)});}catch(e){next(e);}});
launchCampaignsRouter.post("/",async(req,res,next)=>{try{res.status(201).json({campaigns:await service.create(req.user!.sub,schema.parse(req.body))});}catch(e){next(e);}});
launchCampaignsRouter.post("/product/:productId/activate",async(req,res,next)=>{try{res.json(await service.activateNow(req.params.productId,req.user!.sub));}catch(e){next(e);}});
launchCampaignsRouter.post("/:id/launch",async(req,res,next)=>{try{res.json({campaigns:await service.launch(req.params.id,req.user!.sub)});}catch(e){next(e);}});
launchCampaignsRouter.post("/:id/cancel",async(req,res,next)=>{try{res.json({campaigns:await service.cancel(req.params.id,req.user!.sub)});}catch(e){next(e);}});
