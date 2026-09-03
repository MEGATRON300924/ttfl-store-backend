import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { AppError } from "@/utils/app-error";
import { deleteStoreBranding, uploadStoreGalleryImage, validateUploadFile } from "@/modules/uploads/uploads.service";
import * as service from "./store-profile.service";

export const storeProfileRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

storeProfileRouter.get("/public/:slug", asyncHandler(async (req, res) => {
  res.json({ store: await service.getPublicStoreProfile(req.params.slug) });
}));
storeProfileRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  res.json(await service.getMyStoreProfile(req.user!.sub));
}));

const profileSchema = z.object({ headline: z.string().trim().max(160).nullable().optional(), description: z.string().trim().max(3000).nullable().optional(), theme: z.enum(["CLASSIC", "DARK", "MINIMAL"]).optional(), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), layout: z.enum(["STANDARD", "EDITORIAL", "CATALOG"]).optional(), customUrl: z.string().trim().max(80).nullable().optional() });
storeProfileRouter.patch("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  res.json(await service.updateMyStoreProfile(req.user!.sub, profileSchema.parse(req.body), req.ip));
}));

storeProfileRouter.post("/me/gallery", requireAuth, requireRole("VENDOR"), upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest("No image file provided", "NO_FILE");
  validateUploadFile({ mimetype: req.file.mimetype, size: req.file.size });
  const result = await uploadStoreGalleryImage(req.user!.sub, req.file.buffer, req.file.mimetype);
  try { res.status(201).json({ image: await service.addGalleryImage(req.user!.sub, result.url, result.publicId) }); }
  catch (error) { await deleteStoreBranding(result.publicId); throw error; }
}));

storeProfileRouter.delete("/me/gallery/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const publicId = await service.deleteGalleryImage(req.user!.sub, req.params.id);
  await deleteStoreBranding(publicId);
  res.status(204).send();
}));

storeProfileRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  res.json({ stores: await service.getAdminStoreProfiles() });
}));
storeProfileRouter.get("/admin/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  res.json({ store: await service.getAdminStoreProfile(req.params.id) });
}));
const badgeSchema = z.object({ badge: z.enum(["VERIFIED", "BUSINESS", "ENTERPRISE", "PLATINUM"]), enabled: z.boolean() });
storeProfileRouter.post("/admin/:id/badge", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const data = badgeSchema.parse(req.body);
  res.json({ store: await service.setBadge(req.params.id, data.badge, data.enabled, req.user!.sub, req.ip) });
}));

export default storeProfileRouter;
