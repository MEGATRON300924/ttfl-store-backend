import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./flash-deals.service";

export const flashDealsRouter = Router();
flashDealsRouter.get("/", asyncHandler(async (_req, res) => { res.json({ deals: await service.listActive() }); }));
flashDealsRouter.get("/mine", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.json({ deals: await service.listMine(req.user!.sub) }); }));
const dealSchema = z.object({ productId: z.string().uuid(), discountPercent: z.number().positive().max(99), startsAt: z.string().min(1), endsAt: z.string().min(1) });
flashDealsRouter.post("/mine", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.status(201).json({ deals: await service.upsert(req.user!.sub, dealSchema.parse(req.body)) }); }));
flashDealsRouter.delete("/mine/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.json(await service.remove(req.user!.sub, req.params.id)); }));
flashDealsRouter.post("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.status(201).json({ deals: await service.adminCreate(req.user!.sub, dealSchema.parse(req.body)) }); }));
flashDealsRouter.delete("/admin/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.json(await service.adminRemove(req.params.id, req.user!.sub)); }));
