import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import * as service from "./legal.service";

export const legalRouter = Router();

legalRouter.get("/terms", asyncHandler(async (_req, res) => {
  res.json({ terms: service.getCurrentTerms() });
}));

legalRouter.get("/terms/status", requireAuth, asyncHandler(async (req, res) => {
  const accepted = await service.requireCurrentTerms(req.user!.sub);
  res.json({ accepted, terms: service.getCurrentTerms() });
}));

legalRouter.post("/terms/accept", requireAuth, asyncHandler(async (req, res) => {
  res.json(await service.acceptCurrentTerms(req.user!.sub, req.ip));
}));
