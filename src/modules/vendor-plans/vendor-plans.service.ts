import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import type { VendorTier, BillingPeriod } from "@prisma/client";

const PLAN_FEATURES: Record<VendorTier, string[]> = {
  FREE: ["Up to 20 products", "Basic store page", "TTFL checkout, external links and WhatsApp selling", "Basic order management", "Customer reviews", "Basic analytics", "3 Coming Soon products", "Notify Me waitlists", "Basic discounts"],
  PRO: ["Up to 200 products", "Everything in Free", "20 Coming Soon products", "3 active Flash Deals", "5 Sponsored Products", "2 Featured Products", "Advanced analytics", "Launch scheduling", "Priority support"],
  BUSINESS: ["Up to 1,000 products", "Everything in Pro", "100 Coming Soon products", "10 active Flash Deals", "20 Sponsored Products", "8 Featured Products", "2 Featured Stores", "Advanced promotion analytics", "Bulk catalog tools", "Priority support"],
  ENTERPRISE: ["Unlimited products", "Everything in Business", "Unlimited Coming Soon products", "25 active Flash Deals", "100 Sponsored Products", "20 Featured Products", "10 Featured Stores", "Advanced promotion analytics", "Bulk catalog tools", "API access", "Dedicated support"],
};
const FALLBACK_DEFAULTS: Record<VendorTier, { name: string; price: number; productLimit: number | null; commissionRate: number }> = {
  FREE: { name: "Free", price: 0, productLimit: 20, commissionRate: 8 },
  PRO: { name: "Pro", price: 15000, productLimit: 200, commissionRate: 6 },
  BUSINESS: { name: "Business", price: 45000, productLimit: 1000, commissionRate: 4 },
  ENTERPRISE: { name: "Enterprise", price: 150000, productLimit: null, commissionRate: 2 },
};
export function getPlanFeatures(tier: VendorTier) { return PLAN_FEATURES[tier]; }
export async function listPlans() { await prisma.vendorPlan.updateMany({ where: { billingPeriod: "YEARLY" }, data: { billingPeriod: "MONTHLY" } }); const plans = await prisma.vendorPlan.findMany({ orderBy: { price: "asc" } }); return plans.map((plan) => ({ ...plan, features: plan.features?.length ? plan.features : PLAN_FEATURES[plan.tier] })); }
export async function getPlanForTier(tier: VendorTier) { const plan = await prisma.vendorPlan.findUnique({ where: { tier } }); if (plan) { if (plan.billingPeriod !== "MONTHLY") return prisma.vendorPlan.update({ where: { id: plan.id }, data: { billingPeriod: "MONTHLY", features: plan.features?.length ? plan.features : PLAN_FEATURES[tier] } }); return plan; } const fallback = FALLBACK_DEFAULTS[tier]; return prisma.vendorPlan.create({ data: { tier, name: fallback.name, price: fallback.price, billingPeriod: "MONTHLY", productLimit: fallback.productLimit, commissionRate: fallback.commissionRate, features: PLAN_FEATURES[tier] } }); }
export async function upsertPlan(tier: VendorTier, input: { name: string; price: number; billingPeriod: BillingPeriod; productLimit: number | null; commissionRate: number; features?: string[]; active?: boolean }, adminId: string) { const existing = await prisma.vendorPlan.findUnique({ where: { tier } }); const plan = await prisma.vendorPlan.upsert({ where: { tier }, create: { tier, ...input, billingPeriod: "MONTHLY", features: input.features?.length ? input.features : PLAN_FEATURES[tier] }, update: { ...input, billingPeriod: "MONTHLY", ...(input.features?.length ? {} : { features: PLAN_FEATURES[tier] }) } }); await recordAudit({ actorId: adminId, action: existing ? "VENDOR_PLAN_UPDATED" : "VENDOR_PLAN_CREATED", targetType: "VendorPlan", targetId: plan.id, metadata: { ...input, billingPeriod: "MONTHLY" } }); return plan; }
export async function assertProductLimitNotExceeded(vendorId: string, tier: VendorTier) { const plan = await getPlanForTier(tier); if (plan.productLimit == null) return; const currentCount = await prisma.product.count({ where: { vendorId, deletedAt: null } }); if (currentCount >= plan.productLimit) throw AppError.forbidden(`Your ${plan.name} plan allows up to ${plan.productLimit} products. Upgrade your plan to list more.`, "PRODUCT_LIMIT_REACHED"); }
