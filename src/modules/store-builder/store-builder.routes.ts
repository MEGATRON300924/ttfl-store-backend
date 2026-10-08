import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./store-builder.service";

export const storeBuilderRouter = Router();

storeBuilderRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req,res) => {
  res.json(await service.getConfig(req.user!.sub));
}));

storeBuilderRouter.put("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req,res) => {
  z.object({ config: z.record(z.unknown()) }).parse(req.body);
  res.json(await service.saveConfig(req.user!.sub, req.body.config));
}));

storeBuilderRouter.get("/public/:vendorId", asyncHandler(async (req,res) => {
  res.json(await service.getPublicConfig(req.params.vendorId));
}));

storeBuilderRouter.get("/access", requireAuth, requireRole("VENDOR"), asyncHandler(async (req,res) => {
  res.json(await service.getBuilderAccess(req.user!.sub));
}));
