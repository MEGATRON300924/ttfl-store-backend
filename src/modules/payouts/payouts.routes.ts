import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getVendorProfileForUser, requireVendorOwner } from "@/lib/vendor-access";
import * as payoutsService from "./payouts.service";
import * as staffPayoutService from "@/modules/vendor-staff/vendor-staff-payout.service";

export const payoutsRouter = Router();

payoutsRouter.get("/me/balance", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const vendor = await getVendorProfileForUser(req.user!.sub);
  res.json({ balance: await payoutsService.getVendorBalance(vendor.id) });
}));

payoutsRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const vendor = await getVendorProfileForUser(req.user!.sub);
  res.json({ payouts: await payoutsService.getMyPayouts(vendor.id) });
}));

payoutsRouter.get("/me/account", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  res.json({ account: await staffPayoutService.getStaffPayoutAccount(req.user!.sub) });
}));

const accountSchema = z.object({
  bankCode: z.string().min(2).max(20),
  accountNumber: z.string().regex(/^\d{6,20}$/),
});

payoutsRouter.get("/banks", requireAuth, requireRole("VENDOR"), asyncHandler(async (_req, res) => {
  res.json({ banks: await payoutsService.getBanks() });
}));

payoutsRouter.put("/me/account", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  await requireVendorOwner(req.user!.sub);
  res.json({ account: await payoutsService.savePaystackAccount(req.user!.sub, accountSchema.parse(req.body)) });
}));

// Vendor earnings are settled automatically by Paystack subaccount settlement.
// Manual withdrawal requests are intentionally not exposed.
const statusQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAID"]).optional() });

payoutsRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { status } = statusQuerySchema.parse(req.query);
  res.json({ payouts: await payoutsService.adminListPayouts(status) });
}));

// Legacy payout mutation endpoints are intentionally removed. Existing payout
// records remain read-only for historical/audit purposes and cannot move money.
