import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import { awardReview } from "@/modules/rewards/rewards.service";

export const REVIEW_CATEGORY_FIELDS = [
  "deliveryRating",
  "customerServiceRating",
  "productQualityRating",
  "descriptionAccuracyRating",
  "valueForMoneyRating",
] as const;

export type ReviewCategoryRating = "EXCELLENT" | "GOOD" | "BAD";

const BAD_REVIEW_DAYS = 90;
const BAD_REVIEW_THRESHOLD = 3;

async function refreshProductRatingCache(productId: string) {
  const agg = await prisma.review.aggregate({
    where: { productId, status: "VISIBLE" },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await prisma.product.update({
    where: { id: productId },
    data: { avgRating: agg._avg.rating ?? null, reviewCount: agg._count.rating },
  });
}

function hasCategoryRatings(input: Partial<Record<(typeof REVIEW_CATEGORY_FIELDS)[number], ReviewCategoryRating>>) {
  return REVIEW_CATEGORY_FIELDS.every((field) => input[field]);
}

export async function createReview(
  customerId: string,
  input: {
    productId: string;
    orderItemId: string;
    rating: number;
    comment?: string;
    images?: string[];
    deliveryRating: ReviewCategoryRating;
    customerServiceRating: ReviewCategoryRating;
    productQualityRating: ReviewCategoryRating;
    descriptionAccuracyRating: ReviewCategoryRating;
    valueForMoneyRating: ReviewCategoryRating;
  },
) {
  if (input.rating < 1 || input.rating > 5) throw AppError.badRequest("Rating must be between 1 and 5", "INVALID_RATING");
  if (!hasCategoryRatings(input)) throw AppError.badRequest("Please rate every store experience category", "MISSING_REVIEW_CATEGORIES");

  const orderItem = await prisma.orderItem.findUnique({
    where: { id: input.orderItemId },
    include: { vendorOrder: { include: { order: true } } },
  });
  if (!orderItem || orderItem.productId !== input.productId) throw AppError.badRequest("This order item doesn't match the product you're reviewing", "INVALID_ORDER_ITEM");
  if (orderItem.vendorOrder.order.customerId !== customerId) throw AppError.forbidden("You can only review your own purchases");
  if (orderItem.vendorOrder.order.paymentStatus !== "PAID") throw AppError.badRequest("You can only review products from paid orders", "ORDER_NOT_PAID");
  if (orderItem.vendorOrder.status !== "DELIVERED") throw AppError.badRequest("You can review this purchase after it has been delivered", "ORDER_NOT_DELIVERED");

  const existing = await prisma.review.findUnique({ where: { productId_customerId: { productId: input.productId, customerId } } });
  if (existing) throw AppError.conflict("You've already reviewed this product", "ALREADY_REVIEWED");

  const review = await prisma.review.create({
    data: {
      productId: input.productId,
      customerId,
      orderItemId: input.orderItemId,
      rating: input.rating,
      comment: input.comment,
      images: input.images ?? [],
      deliveryRating: input.deliveryRating,
      customerServiceRating: input.customerServiceRating,
      productQualityRating: input.productQualityRating,
      descriptionAccuracyRating: input.descriptionAccuracyRating,
      valueForMoneyRating: input.valueForMoneyRating,
    },
  });

  await refreshProductRatingCache(input.productId);
  void awardReview(customerId, review.id).catch(() => undefined);
  return review;
}

export async function getProductReviews(productId: string, page: number, limit: number) {
  const where = { productId, status: "VISIBLE" as const };
  const [items, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

async function getStoreReviewHealth(vendorId: string) {
  const cutoff = new Date(Date.now() - BAD_REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRawUnsafe<Array<{
    recentReviews: bigint;
    recentOrders: bigint;
    problemOrders: bigint;
    badReviews: bigint;
    deliveryBad: bigint;
    customerServiceBad: bigint;
    productQualityBad: bigint;
    descriptionAccuracyBad: bigint;
    valueForMoneyBad: bigint;
  }>>(
    `SELECT
       COUNT(*) FILTER (WHERE r."createdAt" >= $2 AND r.status = 'VISIBLE') AS "recentReviews", (SELECT COUNT(*) FROM vendor_orders vo WHERE vo.vendor_id=$1 AND vo."createdAt">=$2) AS "recentOrders", (SELECT COUNT(*) FROM vendor_orders vo WHERE vo.vendor_id=$1 AND vo."createdAt">=$2 AND vo.status IN ('CANCELLED','FAILED','REFUNDED')) AS "problemOrders",
       COUNT(*) FILTER (
         WHERE r."createdAt" >= $2
           AND r.status = 'VISIBLE'
           AND (
             r.rating <= 2
             OR (
               (CASE WHEN r.delivery_rating = 'BAD' THEN 1 ELSE 0 END) +
               (CASE WHEN r.customer_service_rating = 'BAD' THEN 1 ELSE 0 END) +
               (CASE WHEN r.product_quality_rating = 'BAD' THEN 1 ELSE 0 END) +
               (CASE WHEN r.description_accuracy_rating = 'BAD' THEN 1 ELSE 0 END) +
               (CASE WHEN r.value_for_money_rating = 'BAD' THEN 1 ELSE 0 END)
             ) >= 2
           )
       ) AS "badReviews",
       COUNT(*) FILTER (WHERE r."createdAt" >= $2 AND r.status = 'VISIBLE' AND r.delivery_rating = 'BAD') AS "deliveryBad",
       COUNT(*) FILTER (WHERE r."createdAt" >= $2 AND r.status = 'VISIBLE' AND r.customer_service_rating = 'BAD') AS "customerServiceBad",
       COUNT(*) FILTER (WHERE r."createdAt" >= $2 AND r.status = 'VISIBLE' AND r.product_quality_rating = 'BAD') AS "productQualityBad",
       COUNT(*) FILTER (WHERE r."createdAt" >= $2 AND r.status = 'VISIBLE' AND r.description_accuracy_rating = 'BAD') AS "descriptionAccuracyBad",
       COUNT(*) FILTER (WHERE r."createdAt" >= $2 AND r.status = 'VISIBLE' AND r.value_for_money_rating = 'BAD') AS "valueForMoneyBad"
     FROM reviews r
     INNER JOIN products p ON p.id = r."productId"
     WHERE p.vendor_id = $1`,
    vendorId,
    cutoff,
  );

  const row = rows[0];
  const badReviews = Number(row?.badReviews ?? 0);
  return {
    windowDays: BAD_REVIEW_DAYS,
    recentReviews: Number(row?.recentReviews ?? 0),
    recentOrders: Number(row?.recentOrders ?? 0),
    problemOrders: Number(row?.problemOrders ?? 0),
    badReviews,
    caution: badReviews >= BAD_REVIEW_THRESHOLD,
    threshold: BAD_REVIEW_THRESHOLD,
    categories: {
      delivery: Number(row?.deliveryBad ?? 0),
      customerService: Number(row?.customerServiceBad ?? 0),
      productQuality: Number(row?.productQualityBad ?? 0),
      descriptionAccuracy: Number(row?.descriptionAccuracyBad ?? 0),
      valueForMoney: Number(row?.valueForMoneyBad ?? 0),
    },
  };
}

export async function getStoreReviews(storeSlug: string, page: number, limit: number) {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { storeSlug },
    select: { id: true, storeName: true, storeSlug: true, bio: true, location: true, logoUrl: true, verified: true, status: true },
  });
  if (!vendor || vendor.status !== "APPROVED") throw AppError.notFound("Store not found");

  const where = { status: "VISIBLE" as const, product: { vendorId: vendor.id } };
  const [aggregate, items, total, health] = await Promise.all([
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
    getStoreReviewHealth(vendor.id),
  ]);

  return {
    store: vendor,
    rating: aggregate._avg.rating ?? null,
    reviewCount: aggregate._count.rating,
    health,
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function reportReview(reviewId: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw AppError.notFound("Review not found", "REVIEW_NOT_FOUND");
  if (review.status === "REPORTED") return review;
  if (review.status === "HIDDEN") throw AppError.badRequest("This review is already hidden", "REVIEW_HIDDEN");
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
  return prisma.review.findMany({
    where: { status: "REPORTED" },
    include: { product: { select: { name: true, slug: true } }, customer: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { updatedAt: "desc" },
  });
}
