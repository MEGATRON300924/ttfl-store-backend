import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as settingsService from "./settings.service";

export const settingsRouter = Router();

settingsRouter.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const settings = await settingsService.getPublicSettings();
    res.json(settings);
  })
);

settingsRouter.get(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const settings = await settingsService.getAllSettings();
    res.json({ settings });
  })
);

const updateSchema = z.object({ value: z.string().min(1).max(200) });

settingsRouter.put(
  "/:key",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { value } = updateSchema.parse(req.body);
    const setting = await settingsService.setSetting(req.params.key, value);
    res.json({ setting });
  })
);
