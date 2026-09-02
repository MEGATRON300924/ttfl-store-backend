import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { asyncHandler } from "@/middleware/error-handler";
import * as service from "./affiliates.service";
import { convertOrder } from "./affiliate-convert.service";

export const affiliatesRouter = Router();

affiliatesRouter.get("/program", asyncHandler(async (_req, res) => {
  res.json({ program: await service.getProgram() });
}));

affiliatesRouter.post("/click", asyncHandler(async (req, res) => {
  const data = z.object({
    code: z.string().min(3).max(40),
    sessionId: z.string().max(120).optional(),
    landingPath: z.string().max(500).optional(),
    source: z.string().max(80).optional(),
  }).parse(req.body);
  res.json(await service.recordClick(data.code, data));
}));

affiliatesRouter.post("/join", requireAuth, asyncHandler(async (req, res) => {
  res.json({ affiliate: await service.join(req.user!.sub) });
}));

affiliatesRouter.get("/dashboard", requireAuth, asyncHandler(async (req, res) => {
  const dashboard = await service.getDashboard(req.user!.sub);
  res.json({ dashboard });
}));

affiliatesRouter.post("/convert", requireAuth, asyncHandler(async (req, res) => {
  const data = z.object({ orderNumber: z.string().min(5).max(40), code: z.string().min(3).max(40) }).parse(req.body);
  res.json(await convertOrder(req.user!.sub, data.orderNumber, data.code));
}));
