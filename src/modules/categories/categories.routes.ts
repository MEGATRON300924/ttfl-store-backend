import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as categoriesService from "./categories.service";

export const categoriesRouter = Router();

categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categories = await categoriesService.listCategories();
    res.json({ categories });
  })
);

categoriesRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const category = await categoriesService.getCategoryBySlug(req.params.slug);
    res.json({ category });
  })
);

const createSchema = z.object({
  name: z.string().min(2).max(80),
  icon: z.string().max(60).optional(),
  parentSlug: z.string().optional(),
});

categoriesRouter.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const category = await categoriesService.createCategory(input, req.user!.sub);
    res.status(201).json({ category });
  })
);

const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  icon: z.string().max(60).optional(),
});

categoriesRouter.patch(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const category = await categoriesService.updateCategory(req.params.id, input, req.user!.sub);
    res.json({ category });
  })
);
