import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { initializeTransaction, verifyTransaction } from "@/lib/paystack";
import { recordAudit } from "@/lib/audit";
import { getSettingNumber, SETTING_KEYS } from "@/modules/settings/settings.service";
import type { FeaturedPlacement } from "@prisma/client";

const PLACEMENT_SETTING_KEY: Record<FeaturedPlacement, string> = {
  HOMEPAGE: SETTING_KEYS.FEATURED_HOMEPAGE_PRICE_PER_DAY,
  TRENDING: SETTING_KEYS.FEATURED_TRENDING_PRICE_PER_DAY,
  CATEGORY: SETTING_KEYS.FEATURED_CATEGORY_PRICE_PER_DAY,
  SEARCH: SETTING_KEYS.FEATURED_SEARCH_PRICE_PER_DAY,
};

async function pricePerDayFor(placement: FeaturedPlacement): Promise<number> {
  return getSettingNumber(PLACEMENT_SETTING_KEY[placement]);
}

function priceFor(pricePerDay: number, durationDays: number) {
  return pricePerDay * durationDays;
}

// ---------------------------------------------------------------------------
// Featured products
// ---------------------------------------------------------------------------

export async function purchaseFeaturedProduct(
  vendorId: string,
  vendorEmail: string,
  input: { productId: string; placement: FeaturedPlacement; durationDays: 1 | 7 | 14 | 30 }
) {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product || product.vendorId !== vendorId) {
    throw AppError.forbidden("You can only feature your own products");
  }

  const price = priceFor(await pricePerDayFor(input.placement), input.durationDays);
  const reference = `ttfl_feat_prod_${input.productId}_${Date.now()}`;

  const featured = await prisma.featuredProduct.create({
    data: {
      productId: input.productId,
      vendorId,
      placement: input.placement,
      durationDays: input.durationDays,
      price,
      paymentReference: reference,
      status: "PENDING_PAYMENT",
    },
  });

  const paystack = await initializeTransaction({
    email: vendorEmail,
    amountNaira: price,
    reference,
    callbackUrl: `${env.appUrl}/vendor/dashboard/products/${input.productId}/promote/confirm`,
    metadata: { featuredProductId: featured.id, kind: "featured_product" },
  });

  return { featured, checkoutUrl: paystack.authorization_url };
}

export async function verifyFeaturedProductPayment(reference: string) {
  const featured = await prisma.featuredProduct.findUnique({ where: { paymentReference: reference } });
  if (!featured) throw AppError.notFound("Featured listing not found");
  if (featured.status !== "PENDING_PAYMENT") return featured; // idempotent

  const verification = await verifyTransaction(reference);
  if (verification.status !== "success") {
    return prisma.featuredProduct.update({ where: { id: featured.id }, data: { status: "CANCELLED" } });
  }

  const paidNaira = verification.amount / 100;
  if (Math.round(paidNaira) !== Math.round(Number(featured.price))) {
    throw AppError.badRequest("Payment amount mismatch", "AMOUNT_MISMATCH");
  }

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + featured.durationDays * 24 * 60 * 60 * 1000);

  return prisma.featuredProduct.update({
    where: { id: featured.id },
    data: { status: "ACTIVE", startDate, endDate },
  });
}

/** Used by homepage/category/search/trending sections to pull active promos. */
export async function getActiveFeaturedProducts(placement: FeaturedPlacement, limit = 10) {
  return prisma.featuredProduct.findMany({
    where: { placement, status: "ACTIVE", endDate: { gt: new Date() } },
    include: {
      product: {
        include: { images: { orderBy: { position: "asc" } }, vendor: true, category: true },
      },
    },
    orderBy: { startDate: "desc" },
    take: limit,
  });
}

export async function adminCancelFeaturedProduct(id: string, adminId: string) {
  const featured = await prisma.featuredProduct.update({ where: { id }, data: { status: "CANCELLED" } });
  await recordAudit({ actorId: adminId, action: "FEATURED_PRODUCT_CANCELLED", targetType: "FeaturedProduct", targetId: id });
  return featured;
}

// ---------------------------------------------------------------------------
// Featured stores
// ---------------------------------------------------------------------------

export async function purchaseFeaturedStore(
  vendorId: string,
  vendorEmail: string,
  durationDays: 1 | 7 | 14 | 30
) {
  const storePricePerDay = await getSettingNumber(SETTING_KEYS.FEATURED_STORE_PRICE_PER_DAY);
  const price = priceFor(storePricePerDay, durationDays);
  const reference = `ttfl_feat_store_${vendorId}_${Date.now()}`;

  const featured = await prisma.featuredStore.create({
    data: { vendorId, durationDays, price, paymentReference: reference, status: "PENDING_PAYMENT" },
  });

  const paystack = await initializeTransaction({
    email: vendorEmail,
    amountNaira: price,
    reference,
    callbackUrl: `${env.appUrl}/vendor/dashboard/promote-store/confirm`,
    metadata: { featuredStoreId: featured.id, kind: "featured_store" },
  });

  return { featured, checkoutUrl: paystack.authorization_url };
}

export async function verifyFeaturedStorePayment(reference: string) {
  const featured = await prisma.featuredStore.findUnique({ where: { paymentReference: reference } });
  if (!featured) throw AppError.notFound("Featured store listing not found");
  if (featured.status !== "PENDING_PAYMENT") return featured;

  const verification = await verifyTransaction(reference);
  if (verification.status !== "success") {
    return prisma.featuredStore.update({ where: { id: featured.id }, data: { status: "CANCELLED" } });
  }

  const paidNaira = verification.amount / 100;
  if (Math.round(paidNaira) !== Math.round(Number(featured.price))) {
    throw AppError.badRequest("Payment amount mismatch", "AMOUNT_MISMATCH");
  }

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + featured.durationDays * 24 * 60 * 60 * 1000);

  return prisma.featuredStore.update({
    where: { id: featured.id },
    data: { status: "ACTIVE", startDate, endDate },
  });
}

export async function getActiveFeaturedStores(limit = 10) {
  return prisma.featuredStore.findMany({
    where: { status: "ACTIVE", endDate: { gt: new Date() } },
    include: { vendor: true },
    orderBy: { startDate: "desc" },
    take: limit,
  });
}

export async function adminCancelFeaturedStore(id: string, adminId: string) {
  const featured = await prisma.featuredStore.update({ where: { id }, data: { status: "CANCELLED" } });
  await recordAudit({ actorId: adminId, action: "FEATURED_STORE_CANCELLED", targetType: "FeaturedStore", targetId: id });
  return featured;
}
