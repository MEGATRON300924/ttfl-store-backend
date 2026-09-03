import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "@/middleware/auth";
import { asyncHandler } from "@/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const productDeliveryRouter = Router();
const schema = z.object({ estimatedDeliveryDays: z.number().int().min(1).max(90) });

productDeliveryRouter.patch("/:id/delivery-estimate", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { estimatedDeliveryDays } = schema.parse(req.body);
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user!.sub } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product || product.vendorId !== vendor.id || product.deletedAt) throw AppError.notFound("Product not found");
  const updated = await prisma.product.update({ where: { id: product.id }, data: { estimatedDeliveryDays } });
  res.json({ product: updated });
}));
