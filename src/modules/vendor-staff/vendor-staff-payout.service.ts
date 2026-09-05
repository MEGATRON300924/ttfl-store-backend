import { getVendorProfileForUser } from "@/lib/vendor-access";
import { getSubaccount } from "@/lib/paystack";

export async function getStaffPayoutAccount(userId: string) {
  const vendor = await getVendorProfileForUser(userId);
  if (!vendor.paystackSubaccountCode) return { configured: false, subaccountCode: null, bankName: null, accountLast4: null, accountName: null, active: false, verified: false };
  try {
    const remote = await getSubaccount(vendor.paystackSubaccountCode);
    return { configured: true, subaccountCode: vendor.paystackSubaccountCode, bankName: remote.settlement_bank ?? vendor.paystackBankName, accountLast4: vendor.paystackAccountLast4, accountName: remote.account_name ?? vendor.paystackAccountName, active: Boolean(remote.active), verified: Boolean(remote.is_verified), settlementSchedule: remote.settlement_schedule ?? "AUTO" };
  } catch {
    return { configured: true, subaccountCode: vendor.paystackSubaccountCode, bankName: vendor.paystackBankName, accountLast4: vendor.paystackAccountLast4, accountName: vendor.paystackAccountName, active: vendor.paystackSubaccountActive, verified: vendor.paystackSubaccountVerified, settlementSchedule: "AUTO" };
  }
}
