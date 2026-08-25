import { prisma } from "@/lib/prisma";
import type { VendorTier } from "@prisma/client";
import { getPlanForTier } from "@/modules/vendor-plans/vendor-plans.service";

/**
 * Resolution order (spec §16):
 *   1. An active vendor-specific CommissionRule
 *   2. VendorProfile.commissionRateOverride (set by admin on the vendor record)
 *   3. The vendor's plan commission rate — admin-configurable via
 *      vendor-plans module (Phase 2 §4), not a hard-coded map anymore.
 * Returns a percentage (e.g. 6 means 6%).
 */
export async function resolveCommissionRate(vendorId: string): Promise<number> {
  const vendorRule = await prisma.commissionRule.findFirst({
    where: { vendorId, active: true, type: "PERCENTAGE" },
    orderBy: { createdAt: "desc" },
  });
  if (vendorRule) return Number(vendorRule.value);

  const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
  if (vendor.commissionRateOverride != null) return Number(vendor.commissionRateOverride);

  const plan = await getPlanForTier(vendor.tier as VendorTier);
  return Number(plan.commissionRate);
}

export function calculateCommission(subtotal: number, ratePercent: number) {
  const commissionAmount = Math.round(subtotal * (ratePercent / 100) * 100) / 100;
  const vendorEarnings = Math.round((subtotal - commissionAmount) * 100) / 100;
  return { commissionAmount, vendorEarnings };
}
