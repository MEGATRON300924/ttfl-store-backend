import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./store-profile.service";

export const storeVisibilityRouter=Router();
storeVisibilityRouter.get("/me",requireAuth,requireRole("VENDOR"),asyncHandler(async(req,res)=>{res.json(await service.getMyStoreProfile(req.user!.sub));}));
storeVisibilityRouter.patch("/me",requireAuth,requireRole("VENDOR"),asyncHandler(async(req,res)=>{const data=z.object({visibility:z.enum(["PUBLIC","PRIVATE","DISPLAY"])}).parse(req.body);res.json(await service.setMyStoreVisibility(req.user!.sub,data.visibility,req.ip));}));
