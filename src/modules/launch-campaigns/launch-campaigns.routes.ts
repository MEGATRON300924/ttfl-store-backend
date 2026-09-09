import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import * as service from "./launch-campaigns.service";

export const launchCampaignsRouter=Router();
const schema=z.object({productId:z.string().min(1),launchAt:z.string().datetime(),homepage:z.boolean().optional(),flashDealId:z.string().nullable().optional()});
launchCampaignsRouter.use(requireAuth);
launchCampaignsRouter.get("/mine",async(req,res,next)=>{try{res.json({campaigns:await service.getMine(req.user!.sub)});}catch(e){next(e);}});
launchCampaignsRouter.post("/",async(req,res,next)=>{try{res.status(201).json({campaigns:await service.create(req.user!.sub,schema.parse(req.body))});}catch(e){next(e);}});
launchCampaignsRouter.post("/:id/launch",async(req,res,next)=>{try{res.json({campaigns:await service.launch(req.params.id,req.user!.sub)});}catch(e){next(e);}});
launchCampaignsRouter.post("/:id/cancel",async(req,res,next)=>{try{res.json({campaigns:await service.cancel(req.params.id,req.user!.sub)});}catch(e){next(e);}});
