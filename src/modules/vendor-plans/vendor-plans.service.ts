import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import type { VendorTier, BillingPeriod } from "@prisma/client";

// Used only if a VendorPlan row is somehow missing for a tier (e.g. a
// fresh DB before the seed script has run) — the real source of truth is
// the vendor_plans table, which admin edits through this module.
const FALLBACK_DEFAULTS: Record<VendorTier, { name: string; price: number; productLimit: number | null; commissionRate: number }> = {
  FREE: { name: "Free", price: 0, productLimit: 20, commissionRate: 8 },
  PRO: { name: "Pro", price: 15000, productLimit: 200, commissionRate: 6 },
  BUSINESS: { name: "Business", price: 45000, productLimit: 1000, commissionRate: 4 },
  ENTERPRISE: { name: "Enterprise", price: 150000, productLimit: null, commissionRate: 2 },
};

export async function listPlans() {
  return prisma.vendorPlan.findMany({ orderBy: { price: "asc" } });
}

export async function getPlanForTier(tier: VendorTier) {
  const plan = await prisma.vendorPlan.findUnique({ where: { tier } });
  if (plan) return plan;

  // No row yet — create one from the fallback so every future read hits
  // the DB, not this constant. Keeps "admin edits become real" true even
  // before anyone's touched the admin panel.
  const fallback = FALLBACK_DEFAULTS[tier];
  return prisma.vendorPlan.create({
    data: {
      tier,
      name: fallback.name,
      price: fallback.price,
      productLimit: fallback.productLimit,
      commissionRate: fallback.commissionRate,
    },
  });
}

export async function upsertPlan(
  tier: VendorTier,
  input: {
    name: string;
    price: number;
    billingPeriod: BillingPeriod;
    productLimit: number | null;
    commissionRate: number;
    features?: string[];
    active?: boolean;
  },
  adminId: string
) {
  const existing = await prisma.vendorPlan.findUnique({ where: { tier } });

  const plan = await prisma.vendorPlan.upsert({
    where: { tier },
    create: { tier, ...input },
    update: input,
  });

  await recordAudit({
    actorId: adminId,
    action: existing ? "VENDOR_PLAN_UPDATED" : "VENDOR_PLAN_CREATED",
    targetType: "VendorPlan",
    targetId: plan.id,
    metadata: input,
  });

  return plan;
}

/**
 * The enforcement point (spec §4 — "the API must enforce this, not the
 * frontend"). Called from products.service.createProduct before insert.
 */
export async function assertProductLimitNotExceeded(vendorId: string, tier: VendorTier) {
  const plan = await getPlanForTier(tier);
  if (plan.productLimit == null) return; // unlimited

  const currentCount = await prisma.product.count({
    where: { vendorId, deletedAt: null },
  });

  if (currentCount >= plan.productLimit) {
    throw AppError.forbidden(
      `Your ${plan.name} plan allows up to ${plan.productLimit} products. Upgrade your plan to list more.`,
      "PRODUCT_LIMIT_REACHED"
    );
  }
}
