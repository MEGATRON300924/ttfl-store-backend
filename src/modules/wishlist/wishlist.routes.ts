import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import * as wishlistService from "./wishlist.service";

export const wishlistRouter = Router();

wishlistRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await wishlistService.getWishlist(req.user!.sub);
    res.json({ items });
  })
);

const productIdSchema = z.object({ productId: z.string().uuid() });

wishlistRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { productId } = productIdSchema.parse(req.body);
    const item = await wishlistService.addToWishlist(req.user!.sub, productId);
    res.status(201).json({ item });
  })
);

wishlistRouter.delete(
  "/:productId",
  requireAuth,
  asyncHandler(async (req, res) => {
    await wishlistService.removeFromWishlist(req.user!.sub, req.params.productId);
    res.status(204).send();
  })
);
