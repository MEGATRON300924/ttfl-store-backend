import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import { sendEmail, payoutApprovedEmail } from "@/lib/email";
import { resolveCommissionRate } from "@/lib/commissions";
import { getSettingNumber, SETTING_KEYS } from "@/modules/settings/settings.service";
import { createSubaccount, getSubaccount, listBanks, updateSubaccount } from "@/lib/paystack";

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
  const vendorOrders = await prisma.vendorOrder.findMany({
    where: {
      vendorId,
      order: { paymentStatus: "PAID" },
      status: { notIn: ["CANCELLED", "REFUNDED"] },
    },
    select: { id: true, vendorEarnings: true, subtotal: true, commissionAmount: true },
  });

  const grossSales = vendorOrders.reduce((sum, vo) => sum + Number(vo.subtotal), 0);
  const totalCommission = vendorOrders.reduce((sum, vo) => sum + Number(vo.commissionAmount), 0);
  const totalEarnings = vendorOrders.reduce((sum, vo) => sum + Number(vo.vendorEarnings), 0);
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
      paystackSubaccountCode: true,
      paystackBankName: true,
      paystackAccountLast4: true,
      paystackAccountName: true,
      paystackSubaccountVerified: true,
    },
  });

  return {
    grossSales,
    totalCommission,
    totalEarnings,
    // These legacy fields are deliberately null: vendorOrder.payoutStatus is not
    // a reliable record of Paystack's bank settlement and must not be presented as
    // money paid or available for withdrawal.
    paidOut: null,
    availableBalance: null,
    settlementPending: null,
    settlementMode: "PAYSTACK_AUTOMATIC",
    payoutAccountConfigured: Boolean(vendor?.paystackSubaccountCode),
    payoutAccountVerified: Boolean(vendor?.paystackSubaccountVerified),
    payoutBankName: vendor?.paystackBankName ?? null,
    payoutAccountLast4: vendor?.paystackAccountLast4 ?? null,
    payoutAccountName: vendor?.paystackAccountName ?? null,
    eligibleVendorOrderIds: [],
  };
}

export async function getMyPayouts(vendorId: string) {
  return prisma.payout.findMany({ where: { vendorId }, orderBy: { requestedAt: "desc" } });
}

export async function adminListPayouts(status?: "PENDING" | "APPROVED" | "REJECTED" | "PAID") {
  return prisma.payout.findMany({ where: status ? { status } : undefined, include: { vendor: { select: { storeName: true } } }, orderBy: { requestedAt: "desc" } });
}
