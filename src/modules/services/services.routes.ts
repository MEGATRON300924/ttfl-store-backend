import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./services.service";

export const servicesRouter = Router();

const serviceSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(5000),
  categorySlug: z.string().trim().max(120).nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  priceType: z.enum(["FIXED", "STARTING_FROM", "QUOTE"]).optional(),
  location: z.string().trim().max(160).nullable().optional(),
  serviceArea: z.string().trim().max(300).nullable().optional(),
  bookingRequired: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional(),
});

servicesRouter.get("/", asyncHandler(async (req, res) => {
  res.json({ services: await service.listServices({ q: String(req.query.q ?? ""), category: String(req.query.category ?? ""), location: String(req.query.location ?? ""), vendor: String(req.query.vendor ?? ""), limit: Number(req.query.limit ?? 24) }) });
}));
servicesRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.json({ services: await service.getMyServices(req.user!.sub) }); }));
servicesRouter.get("/:id", asyncHandler(async (req, res) => { res.json({ service: await service.getServiceById(req.params.id) }); }));
servicesRouter.post("/", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.status(201).json({ service: await service.createService(req.user!.sub, serviceSchema.parse(req.body)) }); }));
servicesRouter.patch("/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.json({ services: await service.updateService(req.user!.sub, req.params.id, serviceSchema.partial().extend({ status: z.enum(["DRAFT","ACTIVE","PAUSED","SUSPENDED"]).optional() }).parse(req.body)) }); }));
