import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import { sendEmail, payoutApprovedEmail } from "@/lib/email";
import { getSettingNumber, SETTING_KEYS } from "@/modules/settings/settings.service";
import { createSubaccount, getSubaccount, listBanks, updateSubaccount } from "@/lib/paystack";
import { resolveCommissionRate } from "@/lib/commissions";

export async function getPaystackAccount(userId: string) {
  const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });
  if (!vendor.paystackSubaccountCode) {
    return { configured: false, subaccountCode: null, bankName: null, accountLast4: null, accountName: null, active: false, verified: false };
  }

  try {
    const remote = await getSubaccount(vendor.paystackSubaccountCode);
    return {
      configured: true,
      subaccountCode: vendor.paystackSubaccountCode,
      bankName: remote.settlement_bank ?? vendor.paystackBankName,
      accountLast4: vendor.paystackAccountLast4,
      accountName: remote.account_name ?? vendor.paystackAccountName,
      active: Boolean(remote.active),
      verified: Boolean(remote.is_verified),
      settlementSchedule: remote.settlement_schedule ?? "AUTO",
    };
  } catch {
    return {
      configured: true,
      subaccountCode: vendor.paystackSubaccountCode,
      bankName: vendor.paystackBankName,
      accountLast4: vendor.paystackAccountLast4,
      accountName: vendor.paystackAccountName,
      active: vendor.paystackSubaccountActive,
      verified: vendor.paystackSubaccountVerified,
      settlementSchedule: "AUTO",
    };
  }
}

export async function getBanks() {
  const banks = await listBanks();
  return banks.filter((bank) => bank.active).map((bank) => ({ code: bank.code, name: bank.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function savePaystackAccount(userId: string, input: { bankCode: string; accountNumber: string }) {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId }, include: { user: true } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  if (vendor.status !== "APPROVED") throw AppError.forbidden("Your store must be approved before you can configure payouts");

  const commissionRate = Number(await resolveCommissionRate(vendor.id));
  const contactName = `${vendor.user.firstName} ${vendor.user.lastName}`.trim();
  const payload = {
    businessName: vendor.storeName,
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
    percentageCharge: commissionRate,
    email: vendor.user.email,
    contactName,
    phone: vendor.user.phone ?? undefined,
  };

  const remote = vendor.paystackSubaccountCode
    ? await updateSubaccount(vendor.paystackSubaccountCode, payload)
    : await createSubaccount(payload);

  const subaccountCode = remote.subaccount_code as string;
  const accountName = (remote.account_name ?? remote.accountName ?? vendor.paystackAccountName ?? contactName) as string;
  const bankName = (remote.settlement_bank ?? vendor.paystackBankName ?? input.bankCode) as string;

  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: {
      paystackSubaccountCode: subaccountCode,
      paystackBankCode: input.bankCode,
      paystackAccountLast4: input.accountNumber.slice(-4),
      paystackAccountName: accountName,
      paystackBankName: bankName,
      paystackSubaccountActive: Boolean(remote.active ?? true),
      paystackSubaccountVerified: Boolean(remote.is_verified ?? false),
    },
  });

  await recordAudit({
    actorId: userId,
    action: "VENDOR_PROFILE_UPDATED",
    targetType: "PaystackSubaccount",
    targetId: vendor.id,
    metadata: { configured: true, bankCode: input.bankCode, accountLast4: input.accountNumber.slice(-4) },
  });

  return getPaystackAccount(userId);
}

export async function getVendorBalance(vendorId: string) {
  const vendorOrders: { id: string; vendorEarnings: unknown; payoutStatus: string; subtotal: unknown; commissionAmount: unknown }[] = await prisma.vendorOrder.findMany({
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
  const settlementPending = vendorOrders.filter((vo) => vo.payoutStatus !== "SETTLED").reduce((sum, vo) => sum + Number(vo.vendorEarnings), 0);
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId }, select: { paystackSubaccountCode: true, paystackBankName: true, paystackAccountLast4: true, paystackAccountName: true, paystackSubaccountVerified: true } });

  return {
    grossSales,
    totalCommission,
    totalEarnings,
    paidOut: totalEarnings - settlementPending,
    availableBalance: settlementPending,
    payoutAccountConfigured: Boolean(vendor?.paystackSubaccountCode),
    payoutAccountVerified: Boolean(vendor?.paystackSubaccountVerified),
    payoutBankName: vendor?.paystackBankName ?? null,
    payoutAccountLast4: vendor?.paystackAccountLast4 ?? null,
    payoutAccountName: vendor?.paystackAccountName ?? null,
    settlementPending,
    eligibleVendorOrderIds: vendorOrders.filter((vo) => vo.payoutStatus !== "SETTLED").map((vo) => vo.id),
  };
}

export async function requestPayout(_vendorId: string) {
  throw AppError.badRequest("Vendor earnings are settled automatically through Paystack. No withdrawal request is required.", "AUTOMATIC_SETTLEMENT");
}

export async function getMyPayouts(vendorId: string) {
  return prisma.payout.findMany({ where: { vendorId }, orderBy: { requestedAt: "desc" } });
}

export async function adminListPayouts(status?: "PENDING" | "APPROVED" | "REJECTED" | "PAID") {
  return prisma.payout.findMany({ where: status ? { status } : undefined, include: { vendor: { select: { storeName: true } } }, orderBy: { requestedAt: "desc" } });
}

export async function adminApprovePayout(id: string, adminId: string) {
  const payout = await prisma.payout.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: adminId }, include: { vendor: { include: { user: true } } } });
  await recordAudit({ actorId: adminId, action: "PAYOUT_APPROVED", targetType: "Payout", targetId: id });
  void sendEmail({ to: payout.vendor.user.email, ...payoutApprovedEmail(Number(payout.amount)) });
  return payout;
}

export async function adminRejectPayout(id: string, adminId: string, note: string) {
  const payout = await prisma.payout.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: adminId, note } });
  await recordAudit({ actorId: adminId, action: "PAYOUT_REJECTED", targetType: "Payout", targetId: id, metadata: { note } });
  return payout;
}

export async function adminMarkPayoutPaid(id: string, adminId: string) {
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
  if (payout.status !== "APPROVED") throw AppError.badRequest("Only approved payouts can be marked as paid", "INVALID_PAYOUT_STATE");
  await prisma.$transaction([
    prisma.payout.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } }),
    prisma.vendorOrder.updateMany({ where: { id: { in: payout.vendorOrderIds } }, data: { payoutStatus: "PAID", payoutAt: new Date() } }),
  ]);
  await recordAudit({ actorId: adminId, action: "PAYOUT_PAID", targetType: "Payout", targetId: id });
  return prisma.payout.findUniqueOrThrow({ where: { id } });
}
