import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import * as payoutsService from "./payouts.service";

export const payoutsRouter = Router();

payoutsRouter.get(
  "/me/balance",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const balance = await payoutsService.getVendorBalance(vendor.id);
    res.json({ balance });
  })
);

payoutsRouter.get(
  "/me",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const payouts = await payoutsService.getMyPayouts(vendor.id);
    res.json({ payouts });
  })
);

payoutsRouter.post(
  "/me/request",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const payout = await payoutsService.requestPayout(vendor.id);
    res.status(201).json({ payout });
  })
);

const statusQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAID"]).optional(),
});

payoutsRouter.get(
  "/admin",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = statusQuerySchema.parse(req.query);
    const payouts = await payoutsService.adminListPayouts(status);
    res.json({ payouts });
  })
);

payoutsRouter.post(
  "/admin/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const payout = await payoutsService.adminApprovePayout(req.params.id, req.user!.sub);
    res.json({ payout });
  })
);

const rejectSchema = z.object({ note: z.string().min(3).max(500) });

payoutsRouter.post(
  "/admin/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { note } = rejectSchema.parse(req.body);
    const payout = await payoutsService.adminRejectPayout(req.params.id, req.user!.sub, note);
    res.json({ payout });
  })
);

payoutsRouter.post(
  "/admin/:id/mark-paid",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const payout = await payoutsService.adminMarkPayoutPaid(req.params.id, req.user!.sub);
    res.json({ payout });
  })
);
