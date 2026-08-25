import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import { sendEmail, payoutApprovedEmail } from "@/lib/email";
import { getSettingNumber, SETTING_KEYS } from "@/modules/settings/settings.service";

/**
 * A vendor's balance is derived, not stored: sum of vendorEarnings across
 * paid, non-cancelled VendorOrders, minus whatever's already been paid out
 * (tracked via VendorOrder.payoutStatus flipping to PAID when a Payout
 * covering it is marked paid).
 */
export async function getVendorBalance(vendorId: string) {
  const vendorOrders: { id: string; vendorEarnings: unknown; payoutStatus: string; subtotal: unknown; commissionAmount: unknown }[] =
    await prisma.vendorOrder.findMany({
      where: {
        vendorId,
        order: { paymentStatus: "PAID" },
        status: { notIn: ["CANCELLED", "REFUNDED"] },
      },
      select: { id: true, vendorEarnings: true, payoutStatus: true, subtotal: true, commissionAmount: true },
    });

  const grossSales = vendorOrders.reduce((sum, vo) => sum + Number(vo.subtotal), 0);
  const totalCommission = vendorOrders.reduce((sum, vo) => sum + Number(vo.commissionAmount), 0);
  const totalEarnings = vendorOrders.reduce((sum, vo) => sum + Number(vo.vendorEarnings), 0);
  const paidOut = vendorOrders
    .filter((vo) => vo.payoutStatus === "PAID")
    .reduce((sum, vo) => sum + Number(vo.vendorEarnings), 0);
  const availableBalance = totalEarnings - paidOut;

  return {
    grossSales,
    totalCommission,
    totalEarnings,
    paidOut,
    availableBalance,
    eligibleVendorOrderIds: vendorOrders.filter((vo) => vo.payoutStatus !== "PAID").map((vo) => vo.id),
  };
}

export async function requestPayout(vendorId: string) {
  const minPayoutAmount = await getSettingNumber(SETTING_KEYS.MIN_PAYOUT_AMOUNT);
  const balance = await getVendorBalance(vendorId);
  if (balance.availableBalance < minPayoutAmount) {
    throw AppError.badRequest(
      `Minimum payout amount is ₦${minPayoutAmount.toLocaleString()}`,
      "BELOW_MIN_PAYOUT"
    );
  }

  const existing = await prisma.payout.findFirst({ where: { vendorId, status: "PENDING" } });
  if (existing) {
    throw AppError.conflict("You already have a pending payout request", "PAYOUT_ALREADY_PENDING");
  }

  return prisma.payout.create({
    data: {
      vendorId,
      amount: balance.availableBalance,
      vendorOrderIds: balance.eligibleVendorOrderIds,
      status: "PENDING",
    },
  });
}

export async function getMyPayouts(vendorId: string) {
  return prisma.payout.findMany({ where: { vendorId }, orderBy: { requestedAt: "desc" } });
}

// --- Admin -------------------------------------------------------------

export async function adminListPayouts(status?: "PENDING" | "APPROVED" | "REJECTED" | "PAID") {
  return prisma.payout.findMany({
    where: status ? { status } : undefined,
    include: { vendor: { select: { storeName: true } } },
    orderBy: { requestedAt: "desc" },
  });
}

export async function adminApprovePayout(id: string, adminId: string) {
  const payout = await prisma.payout.update({
    where: { id },
    data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: adminId },
    include: { vendor: { include: { user: true } } },
  });
  await recordAudit({ actorId: adminId, action: "PAYOUT_APPROVED", targetType: "Payout", targetId: id });
  void sendEmail({ to: payout.vendor.user.email, ...payoutApprovedEmail(Number(payout.amount)) });
  return payout;
}

export async function adminRejectPayout(id: string, adminId: string, note: string) {
  const payout = await prisma.payout.update({
    where: { id },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: adminId, note },
  });
  await recordAudit({ actorId: adminId, action: "PAYOUT_REJECTED", targetType: "Payout", targetId: id, metadata: { note } });
  return payout;
}

/**
 * Marking paid is a RECORD, not a transfer — spec §17 explicitly says not
 * to auto-transfer money without a tested payout integration. An admin
 * does the actual bank transfer manually and then marks it here.
 */
export async function adminMarkPayoutPaid(id: string, adminId: string) {
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
  if (payout.status !== "APPROVED") {
    throw AppError.badRequest("Only approved payouts can be marked as paid", "INVALID_PAYOUT_STATE");
  }

  await prisma.$transaction([
    prisma.payout.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } }),
    prisma.vendorOrder.updateMany({
      where: { id: { in: payout.vendorOrderIds } },
      data: { payoutStatus: "PAID", payoutAt: new Date() },
    }),
  ]);

  await recordAudit({ actorId: adminId, action: "PAYOUT_PAID", targetType: "Payout", targetId: id });
  return prisma.payout.findUniqueOrThrow({ where: { id } });
}
