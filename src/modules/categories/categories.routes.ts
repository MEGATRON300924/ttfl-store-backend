import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as categoriesService from "./categories.service";

export const categoriesRouter = Router();

categoriesRouter.get("/", asyncHandler(async (_req, res) => {
  res.json({ categories: await categoriesService.listCategories() });
}));

categoriesRouter.get("/:slug", asyncHandler(async (req, res) => {
  res.json({ category: await categoriesService.getCategoryBySlug(req.params.slug) });
}));

const optionSchema = z.object({ id: z.string().min(1).max(80), label: z.string().trim().min(1).max(100), value: z.string().trim().min(1).max(100) });
const variationSchema = z.object({ id: z.string().min(1).max(80), key: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(80), type: z.enum(["PRODUCT", "CLOTHING", "OTHER"]), options: z.array(optionSchema).min(1).max(50) });
const variationConfigSchema = z.object({ enabled: z.boolean(), variations: z.array(variationSchema).max(20) });

const createSchema = z.object({ name: z.string().min(2).max(80), icon: z.string().max(60).optional(), parentSlug: z.string().optional(), variationConfig: variationConfigSchema.optional() });
categoriesRouter.post("/", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const category = await categoriesService.createCategory(createSchema.parse(req.body), req.user!.sub); res.status(201).json({ category }); }));

const updateSchema = z.object({ name: z.string().min(2).max(80).optional(), icon: z.string().max(60).nullable().optional(), variationConfig: variationConfigSchema.optional() });
categoriesRouter.patch("/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const category = await categoriesService.updateCategory(req.params.id, updateSchema.parse(req.body), req.user!.sub); res.json({ category }); }));
categoriesRouter.delete("/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { await categoriesService.deleteCategory(req.params.id, req.user!.sub); res.status(204).send(); }));
