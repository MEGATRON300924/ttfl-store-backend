import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./vendor-notification-preferences.service";

export const vendorNotificationPreferencesRouter = Router();
vendorNotificationPreferencesRouter.use(requireAuth, requireRole("VENDOR"));
const schema = z.object({ emailEnabled: z.boolean().optional(), whatsappEnabled: z.boolean().optional(), marketingEnabled: z.boolean().optional() });
vendorNotificationPreferencesRouter.get("/", asyncHandler(async (req, res) => res.json({ preferences: await service.getPreferences(req.user!.sub) })));
vendorNotificationPreferencesRouter.patch("/", asyncHandler(async (req, res) => res.json({ preferences: await service.updatePreferences(req.user!.sub, schema.parse(req.body)) })));
