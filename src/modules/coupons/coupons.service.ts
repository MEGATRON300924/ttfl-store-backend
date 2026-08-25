import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import type { CouponType } from "@prisma/client";

export type CartLineForCoupon = {
  vendorId: string;
  categoryId: string;
  lineTotal: number;
};

/**
 * Validates a coupon code against the actual cart contents and returns the
 * discount to apply. This is the ONLY place discount math happens — spec
 * §11 "never trust the frontend discount calculation" — so checkout always
 * calls this rather than accepting a discount amount from the client.
 */
export async function validateCoupon(
  code: string,
  customerId: string,
  cartLines: CartLineForCoupon[]
): Promise<{ coupon: { id: string; code: string }; discountAmount: number; eligibleBase: number }> {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
  if (!coupon || !coupon.active) {
    throw AppError.badRequest("This coupon code isn't valid", "INVALID_COUPON");
  }

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    throw AppError.badRequest("This coupon isn't active yet", "COUPON_NOT_STARTED");
  }
  if (coupon.expiresAt && coupon.expiresAt < now) {
    throw AppError.badRequest("This coupon has expired", "COUPON_EXPIRED");
  }

  // Eligible base = sum of cart lines this coupon actually applies to —
  // scoped by vendor (if vendor-specific) and category (if restricted).
  const eligibleLines = cartLines.filter((line) => {
    if (coupon.vendorId && line.vendorId !== coupon.vendorId) return false;
    if (coupon.categoryId && line.categoryId !== coupon.categoryId) return false;
    return true;
  });
  const eligibleBase = eligibleLines.reduce((sum, l) => sum + l.lineTotal, 0);

  if (eligibleBase <= 0) {
    throw AppError.badRequest(
      coupon.vendorId ? "This coupon only applies to a specific vendor's items in your cart" : "This coupon doesn't apply to anything in your cart",
      "COUPON_NOT_APPLICABLE"
    );
  }

  if (coupon.minOrderAmount && eligibleBase < Number(coupon.minOrderAmount)) {
    throw AppError.badRequest(
      `This coupon needs a minimum order of ₦${Number(coupon.minOrderAmount).toLocaleString()}`,
      "COUPON_MIN_NOT_MET"
    );
  }

  if (coupon.firstOrderOnly) {
    const priorPaidOrder = await prisma.order.findFirst({
      where: { customerId, paymentStatus: "PAID" },
    });
    if (priorPaidOrder) {
      throw AppError.badRequest("This coupon is only valid on your first order", "COUPON_FIRST_ORDER_ONLY");
    }
  }

  if (coupon.usageLimit != null) {
    const totalUses = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
    if (totalUses >= coupon.usageLimit) {
      throw AppError.badRequest("This coupon has reached its usage limit", "COUPON_LIMIT_REACHED");
    }
  }

  const userUses = await prisma.couponRedemption.count({ where: { couponId: coupon.id, userId: customerId } });
  if (userUses >= coupon.usageLimitPerUser) {
    throw AppError.badRequest("You've already used this coupon", "COUPON_ALREADY_USED");
  }

  const discountAmount = computeDiscount(coupon.type, Number(coupon.value), eligibleBase, coupon.maxDiscountAmount ? Number(coupon.maxDiscountAmount) : null);

  return { coupon: { id: coupon.id, code: coupon.code }, discountAmount, eligibleBase };
}

function computeDiscount(type: CouponType, value: number, base: number, maxDiscount: number | null): number {
  let discount = type === "PERCENTAGE" ? base * (value / 100) : value;
  discount = Math.min(discount, base); // never discount more than the eligible base
  if (maxDiscount != null) discount = Math.min(discount, maxDiscount);
  return Math.round(discount * 100) / 100;
}

/** Called after the order is successfully created — records the redemption. */
export async function recordRedemption(couponId: string, userId: string, orderId: string, discountAmount: number) {
  await prisma.couponRedemption.create({
    data: { couponId, userId, orderId, discountAmount },
  });
}

// --- Admin CRUD ------------------------------------------------------------

export async function adminCreateCoupon(
  input: {
    code: string;
    type: CouponType;
    value: number;
    vendorId?: string;
    categoryId?: string;
    minOrderAmount?: number;
    maxDiscountAmount?: number;
    usageLimit?: number;
    usageLimitPerUser?: number;
    firstOrderOnly?: boolean;
    startsAt?: Date;
    expiresAt?: Date;
  },
  adminId: string
) {
  const existing = await prisma.coupon.findUnique({ where: { code: input.code.toUpperCase() } });
  if (existing) throw AppError.conflict("A coupon with this code already exists", "COUPON_CODE_TAKEN");

  const coupon = await prisma.coupon.create({
    data: { ...input, code: input.code.toUpperCase() },
  });

  await recordAudit({ actorId: adminId, action: "COUPON_CREATED", targetType: "Coupon", targetId: coupon.id });
  return coupon;
}

export async function adminUpdateCoupon(id: string, input: Partial<{ active: boolean; expiresAt: Date; usageLimit: number }>, adminId: string) {
  const coupon = await prisma.coupon.update({ where: { id }, data: input });
  await recordAudit({ actorId: adminId, action: "COUPON_UPDATED", targetType: "Coupon", targetId: coupon.id, metadata: input });
  return coupon;
}

export async function adminListCoupons() {
  return prisma.coupon.findMany({
    include: { vendor: { select: { storeName: true } }, _count: { select: { redemptions: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// Vendor-facing: a vendor can create coupons scoped to only their own store
export async function vendorCreateCoupon(
  vendorId: string,
  input: {
    code: string;
    type: CouponType;
    value: number;
    minOrderAmount?: number;
    maxDiscountAmount?: number;
    usageLimit?: number;
    usageLimitPerUser?: number;
    expiresAt?: Date;
  }
) {
  const existing = await prisma.coupon.findUnique({ where: { code: input.code.toUpperCase() } });
  if (existing) throw AppError.conflict("A coupon with this code already exists", "COUPON_CODE_TAKEN");

  return prisma.coupon.create({
    data: { ...input, code: input.code.toUpperCase(), vendorId },
  });
}

export async function vendorListCoupons(vendorId: string) {
  return prisma.coupon.findMany({
    where: { vendorId },
    include: { _count: { select: { redemptions: true } } },
    orderBy: { createdAt: "desc" },
  });
}
