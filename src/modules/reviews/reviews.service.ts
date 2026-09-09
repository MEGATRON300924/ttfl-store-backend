import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";

async function refreshProductRatingCache(productId: string) {
  const agg = await prisma.review.aggregate({ where: { productId, status: "VISIBLE" }, _avg: { rating: true }, _count: { rating: true } });
  await prisma.product.update({ where: { id: productId }, data: { avgRating: agg._avg.rating ?? null, reviewCount: agg._count.rating } });
}

export async function createReview(customerId: string, input: { productId: string; orderItemId: string; rating: number; comment?: string; images?: string[] }) {
  if (input.rating < 1 || input.rating > 5) throw AppError.badRequest("Rating must be between 1 and 5", "INVALID_RATING");
  const orderItem = await prisma.orderItem.findUnique({ where: { id: input.orderItemId }, include: { vendorOrder: { include: { order: true } } } });
  if (!orderItem || orderItem.productId !== input.productId) throw AppError.badRequest("This order item doesn't match the product you're reviewing", "INVALID_ORDER_ITEM");
  if (orderItem.vendorOrder.order.customerId !== customerId) throw AppError.forbidden("You can only review your own purchases");
  if (orderItem.vendorOrder.order.paymentStatus !== "PAID") throw AppError.badRequest("You can only review products from paid orders", "ORDER_NOT_PAID");
  const existing = await prisma.review.findUnique({ where: { productId_customerId: { productId: input.productId, customerId } } });
  if (existing) throw AppError.conflict("You've already reviewed this product", "ALREADY_REVIEWED");
  const review = await prisma.review.create({ data: { productId: input.productId, customerId, orderItemId: input.orderItemId, rating: input.rating, comment: input.comment, images: input.images ?? [] } });
  await refreshProductRatingCache(input.productId);
  return review;
}

export async function getProductReviews(productId: string, page: number, limit: number) {
  const where = { productId, status: "VISIBLE" as const };
  const [items, total] = await prisma.$transaction([
    prisma.review.findMany({ where, include: { customer: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.review.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Every approved store automatically has a public review page keyed by its store slug. */
export async function getStoreReviews(storeSlug: string, page: number, limit: number) {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { storeSlug },
    select: { id: true, storeName: true, storeSlug: true, bio: true, location: true, logoUrl: true, verified: true, status: true },
  });
  if (!vendor || vendor.status !== "APPROVED") throw AppError.notFound("Store not found");

  const where = { status: "VISIBLE" as const, product: { vendorId: vendor.id } };
  const [aggregate, items, total] = await prisma.$transaction([
    prisma.review.aggregate({ where, _avg: { rating: true }, _count: { rating: true } }),
    prisma.review.findMany({
      where,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        product: { select: { id: true, name: true, slug: true, images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);

  return {
    store: vendor,
    rating: aggregate._avg.rating ?? null,
    reviewCount: aggregate._count.rating,
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function reportReview(reviewId: string) {
  return prisma.review.update({ where: { id: reviewId }, data: { reportCount: { increment: 1 }, status: "REPORTED" } });
}

export async function adminHideReview(reviewId: string, adminId: string) {
  const review = await prisma.review.update({ where: { id: reviewId }, data: { status: "HIDDEN" } });
  await refreshProductRatingCache(review.productId);
  await recordAudit({ actorId: adminId, action: "REVIEW_HIDDEN", targetType: "Review", targetId: review.id });
  return review;
}

export async function adminRestoreReview(reviewId: string) {
  const review = await prisma.review.update({ where: { id: reviewId }, data: { status: "VISIBLE" } });
  await refreshProductRatingCache(review.productId);
  return review;
}

export async function adminDeleteReview(reviewId: string, adminId: string) {
  const review = await prisma.review.delete({ where: { id: reviewId } });
  await refreshProductRatingCache(review.productId);
  await recordAudit({ actorId: adminId, action: "REVIEW_DELETED", targetType: "Review", targetId: reviewId });
}

export async function adminListReported() {
  return prisma.review.findMany({ where: { status: "REPORTED" }, include: { product: { select: { name: true, slug: true } }, customer: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { updatedAt: "desc" } });
}
