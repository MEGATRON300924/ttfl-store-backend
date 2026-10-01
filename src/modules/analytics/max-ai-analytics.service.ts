import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

export async function getMaxAiStoreAnalytics(storeId: string, forceRefresh = false) {
  const cached = cache.get(storeId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;

  const [vendor, productStats, statusGroups, referralGroups, topProducts, reviewHealth, recentSales, categoryStats] = await Promise.all([
    prisma.vendorProfile.findUnique({
      where: { id: storeId },
      select: { id: true, storeName: true, storeSlug: true, status: true, tier: true, verified: true, viewCount: true, createdAt: true },
    }),
    prisma.product.aggregate({
      where: { vendorId: storeId, deletedAt: null },
      _count: { _all: true },
      _sum: { viewCount: true },
    }),
    prisma.vendorOrder.groupBy({
      by: ["status"],
      where: { vendorId: storeId, order: { paymentStatus: "PAID" } },
      _count: { _all: true },
      _sum: { subtotal: true, vendorEarnings: true },
    }),
    prisma.referralEvent.groupBy({
      by: ["type", "source"],
      where: { vendorId: storeId },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ["productId", "productName"],
      where: { vendorOrder: { vendorId: storeId, order: { paymentStatus: "PAID" } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 10,
    }),
    getReviewHealth(storeId),
    getRecentSales(storeId),
    prisma.product.groupBy({
      by: ["status"],
      where: { vendorId: storeId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  if (!vendor) throw new Error("STORE_NOT_FOUND");

  const paidOrderCount = statusGroups.reduce((sum, row) => sum + row._count._all, 0);
  const grossSales = statusGroups.reduce((sum, row) => sum + toNumber(row._sum.subtotal), 0);
  const vendorEarnings = statusGroups.reduce((sum, row) => sum + toNumber(row._sum.vendorEarnings), 0);
  const productViews = toNumber(productStats._sum.viewCount);
  const conversionRate = productViews > 0 ? Math.round((paidOrderCount / productViews) * 10000) / 100 : 0;

  const value = {
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
    store: {
      id: vendor.id,
      storeId: vendor.id,
      name: vendor.storeName,
      slug: vendor.storeSlug,
      status: vendor.status,
      tier: vendor.tier,
      verified: vendor.verified,
      profileViews: vendor.viewCount,
      createdAt: vendor.createdAt,
    },
    performance: {
      orders: paidOrderCount,
      grossSales,
      vendorEarnings,
      averageOrderValue: paidOrderCount > 0 ? Math.round((grossSales / paidOrderCount) * 100) / 100 : 0,
      productViews,
      conversionRate,
      ordersByStatus: Object.fromEntries(statusGroups.map((row) => [row.status, row._count._all])),
    },
    products: {
      total: productStats._count._all,
      views: productViews,
      byStatus: Object.fromEntries(categoryStats.map((row) => [row.status, row._count._all])),
      topSellers: topProducts.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        unitsSold: row._sum.quantity ?? 0,
        revenue: toNumber(row._sum.lineTotal),
      })),
    },
    traffic: referralGroups.map((row) => ({
      type: row.type,
      source: row.source ?? "unknown",
      count: row._count._all,
    })),
    reviews: reviewHealth,
    recentSales,
    interpretationSignals: {
      lowTraffic: productViews < 20,
      lowConversion: productViews >= 20 && conversionRate < 1,
      noPaidOrders: paidOrderCount === 0,
      hasRecentReviewCaution: reviewHealth.caution,
    },
  };

  cache.set(storeId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function getReviewHealth(storeId: string) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRawUnsafe<Array<{ recentReviews: bigint; badReviews: bigint; averageRating: number | null }>>(
    `SELECT
       COUNT(*) FILTER (WHERE r."createdAt">=$2 AND r.status='VISIBLE') AS "recentReviews",
       COUNT(*) FILTER (WHERE r."createdAt">=$2 AND r.status='VISIBLE' AND (r.rating<=2 OR ((CASE WHEN r.delivery_rating='BAD' THEN 1 ELSE 0 END)+(CASE WHEN r.customer_service_rating='BAD' THEN 1 ELSE 0 END)+(CASE WHEN r.product_quality_rating='BAD' THEN 1 ELSE 0 END)+(CASE WHEN r.description_accuracy_rating='BAD' THEN 1 ELSE 0 END)+(CASE WHEN r.value_for_money_rating='BAD' THEN 1 ELSE 0 END))>=2)) AS "badReviews",
       AVG(r.rating) FILTER (WHERE r.status='VISIBLE') AS "averageRating"
     FROM reviews r
     INNER JOIN products p ON p.id=r."productId"
     WHERE p.vendor_id=$1`,
    storeId,
    cutoff,
  );
  const row = rows[0];
  const badReviews = Number(row?.badReviews ?? 0);
  return {
    averageRating: row?.averageRating == null ? null : Number(row.averageRating),
    recentReviews: Number(row?.recentReviews ?? 0),
    badReviews,
    caution: badReviews >= 3,
    threshold: 3,
    windowDays: 90,
  };
}

async function getRecentSales(storeId: string) {
  const rows = await prisma.vendorOrder.findMany({
    where: { vendorId: storeId, order: { paymentStatus: "PAID" } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, subtotal: true, vendorEarnings: true, createdAt: true, order: { select: { orderNumber: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.order.orderNumber,
    status: row.status,
    subtotal: Number(row.subtotal),
    vendorEarnings: Number(row.vendorEarnings),
    createdAt: row.createdAt,
  }));
}
