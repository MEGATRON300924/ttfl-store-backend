import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { AppError } from "@/utils/app-error";
import { prisma } from "@/lib/prisma";
import { deleteStoreBranding, uploadStoreGalleryImage, validateUploadFile } from "@/modules/uploads/uploads.service";
import * as service from "./store-profile.service";

export const storeProfileRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

storeProfileRouter.get("/public/directory", asyncHandler(async (req, res) => {
  await service.ensureStoreProfileTables();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 24) || 24, 1), 48);
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const offset = (page - 1) * limit;
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT vp.id, vp.store_name AS "name", vp.store_slug AS "slug", vp.logo_url AS "logoUrl", vp.location, vp.verified, vp.tier, COUNT(DISTINCT p.id)::int AS "productCount", COALESCE(AVG(p.avg_rating), 0)::float AS rating FROM vendor_profiles vp LEFT JOIN products p ON p.vendor_id = vp.id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL WHERE vp.status = 'APPROVED' AND ($1 = '' OR vp.store_name ILIKE '%' || $1 || '%' OR vp.location ILIKE '%' || $1 || '%') GROUP BY vp.id ORDER BY vp.store_name ASC LIMIT $2 OFFSET $3`,
    search,
    limit,
    offset
  );
  const countRows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM vendor_profiles vp WHERE vp.status = 'APPROVED' AND ($1 = '' OR vp.store_name ILIKE '%' || $1 || '%' OR vp.location ILIKE '%' || $1 || '%')`,
    search
  );
  const ids = rows.map((row) => row.id);
  const badges = ids.length
    ? await prisma.$queryRawUnsafe<Array<{ vendor_id: string; badge: service.StoreBadge }>>(`SELECT vendor_id, badge FROM store_badges WHERE vendor_id = ANY($1::text[]) ORDER BY created_at ASC`, ids)
    : [];
  const badgeMap = new Map<string, service.StoreBadge[]>();
  for (const row of badges) badgeMap.set(row.vendor_id, [...(badgeMap.get(row.vendor_id) ?? []), row.badge]);
  res.json({ stores: rows.map((row) => ({ ...row, productCount: Number(row.productCount), rating: Number(row.rating), badges: badgeMap.get(row.id) ?? (row.verified ? ["VERIFIED"] : []) })), pagination: { page, limit, total: countRows[0]?.count ?? 0, totalPages: Math.ceil((countRows[0]?.count ?? 0) / limit) } });
}));

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
