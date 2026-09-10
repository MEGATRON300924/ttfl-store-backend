import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import * as service from "./notifications.service";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const registerSchema = z.object({
  expoPushToken: z.string().min(10).max(300),
  platform: z.enum(["android", "ios", "web"]).default("android"),
  appVersion: z.string().max(40).optional(),
  deviceName: z.string().max(120).optional(),
});

notificationsRouter.post("/devices", asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  res.status(201).json({ device: await service.registerDevice(req.user!.sub, input) });
}));

notificationsRouter.delete("/devices", asyncHandler(async (req, res) => {
  const token = z.string().min(10).max(300).parse(req.body?.expoPushToken);
  await service.unregisterDevice(req.user!.sub, token);
  res.status(204).send();
}));

notificationsRouter.get("/devices", asyncHandler(async (req, res) => {
  res.json({ devices: await service.listDevices(req.user!.sub) });
}));
