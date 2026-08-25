import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import * as featuredService from "./featured.service";

export const featuredRouter = Router();

const durationSchema = z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)]);

// --- Public reads (homepage/category/search/trending pull these) ---------

featuredRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const placement = (req.query.placement as string)?.toUpperCase() as
      | "HOMEPAGE"
      | "CATEGORY"
      | "SEARCH"
      | "TRENDING";
    if (!["HOMEPAGE", "CATEGORY", "SEARCH", "TRENDING"].includes(placement)) {
      return res.status(400).json({ error: { code: "INVALID_PLACEMENT", message: "Invalid placement" } });
    }
    const items = await featuredService.getActiveFeaturedProducts(placement, Number(req.query.limit ?? 10));
    res.json({ items });
  })
);

featuredRouter.get(
  "/stores",
  asyncHandler(async (req, res) => {
    const items = await featuredService.getActiveFeaturedStores(Number(req.query.limit ?? 10));
    res.json({ items });
  })
);

// --- Vendor purchase flow ---------------------------------------------------

const purchaseProductSchema = z.object({
  productId: z.string().uuid(),
  placement: z.enum(["HOMEPAGE", "CATEGORY", "SEARCH", "TRENDING"]),
  durationDays: durationSchema,
});

featuredRouter.post(
  "/products/purchase",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const [vendor, user] = await Promise.all([
      prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } }),
      prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }),
    ]);
    const input = purchaseProductSchema.parse(req.body);
    const result = await featuredService.purchaseFeaturedProduct(vendor.id, user.email, input);
    res.status(201).json(result);
  })
);

featuredRouter.get(
  "/products/verify/:reference",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const featured = await featuredService.verifyFeaturedProductPayment(req.params.reference);
    res.json({ featured });
  })
);

const purchaseStoreSchema = z.object({ durationDays: durationSchema });

featuredRouter.post(
  "/stores/purchase",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const [vendor, user] = await Promise.all([
      prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } }),
      prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }),
    ]);
    const { durationDays } = purchaseStoreSchema.parse(req.body);
    const result = await featuredService.purchaseFeaturedStore(vendor.id, user.email, durationDays);
    res.status(201).json(result);
  })
);

featuredRouter.get(
  "/stores/verify/:reference",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const featured = await featuredService.verifyFeaturedStorePayment(req.params.reference);
    res.json({ featured });
  })
);

// --- Admin ------------------------------------------------------------------

featuredRouter.post(
  "/products/:id/cancel",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const featured = await featuredService.adminCancelFeaturedProduct(req.params.id, req.user!.sub);
    res.json({ featured });
  })
);

featuredRouter.post(
  "/stores/:id/cancel",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const featured = await featuredService.adminCancelFeaturedStore(req.params.id, req.user!.sub);
    res.json({ featured });
  })
);
