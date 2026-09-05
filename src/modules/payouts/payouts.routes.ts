import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { requireVendorOwner, getVendorProfileForUser } from "@/lib/vendor-access";
import * as payoutsService from "./payouts.service";

export const payoutsRouter = Router();

payoutsRouter.get("/me/balance", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ balance: await payoutsService.getVendorBalance(vendor.id) }); }));
payoutsRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ payouts: await payoutsService.getMyPayouts(vendor.id) }); }));
payoutsRouter.get("/me/account", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const account = await payoutsService.getPaystackAccount(req.user!.sub); res.json({ account }); }));

const accountSchema = z.object({ bankCode: z.string().min(2).max(20), accountNumber: z.string().regex(/^\d{6,20}$/) });
payoutsRouter.get("/banks", requireAuth, requireRole("VENDOR"), asyncHandler(async (_req, res) => { res.json({ banks: await payoutsService.getBanks() }); }));
payoutsRouter.put("/me/account", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { await requireVendorOwner(req.user!.sub); const input = accountSchema.parse(req.body); res.json({ account: await payoutsService.savePaystackAccount(req.user!.sub, input) }); }));
payoutsRouter.post("/me/request", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.status(201).json({ payout: await payoutsService.requestPayout(vendor.id) }); }));

const statusQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAID"]).optional() });
payoutsRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const { status } = statusQuerySchema.parse(req.query); res.json({ payouts: await payoutsService.adminListPayouts(status) }); }));
payoutsRouter.post("/admin/:id/approve", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.json({ payout: await payoutsService.adminApprovePayout(req.params.id, req.user!.sub) }); }));
const rejectSchema = z.object({ note: z.string().min(3).max(500) });
payoutsRouter.post("/admin/:id/reject", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const { note } = rejectSchema.parse(req.body); res.json({ payout: await payoutsService.adminRejectPayout(req.params.id, req.user!.sub, note) }); }));
payoutsRouter.post("/admin/:id/mark-paid", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.json({ payout: await payoutsService.adminMarkPayoutPaid(req.params.id, req.user!.sub) }); }));
