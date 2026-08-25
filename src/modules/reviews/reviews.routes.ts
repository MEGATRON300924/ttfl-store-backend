import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as reviewsService from "./reviews.service";

export const reviewsRouter = Router();

reviewsRouter.get(
  "/product/:productId",
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const result = await reviewsService.getProductReviews(req.params.productId, page, limit);
    res.json(result);
  })
);

const createSchema = z.object({
  productId: z.string().uuid(),
  orderItemId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  images: z.array(z.string().url()).max(6).optional(),
});

reviewsRouter.post(
  "/",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const review = await reviewsService.createReview(req.user!.sub, input);
    res.status(201).json({ review });
  })
);

reviewsRouter.post(
  "/:id/report",
  requireAuth,
  asyncHandler(async (req, res) => {
    const review = await reviewsService.reportReview(req.params.id);
    res.json({ review });
  })
);

// --- Admin moderation ------------------------------------------------------

reviewsRouter.get(
  "/admin/reported",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const reviews = await reviewsService.adminListReported();
    res.json({ reviews });
  })
);

reviewsRouter.post(
  "/admin/:id/hide",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const review = await reviewsService.adminHideReview(req.params.id, req.user!.sub);
    res.json({ review });
  })
);

reviewsRouter.post(
  "/admin/:id/restore",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const review = await reviewsService.adminRestoreReview(req.params.id);
    res.json({ review });
  })
);

reviewsRouter.delete(
  "/admin/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await reviewsService.adminDeleteReview(req.params.id, req.user!.sub);
    res.status(204).send();
  })
);
