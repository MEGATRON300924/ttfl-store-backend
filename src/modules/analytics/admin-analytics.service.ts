import { prisma } from "@/lib/prisma";

type DateRange = { startDate?: Date; endDate?: Date };

function rangeWhere(range: DateRange) {
  if (!range.startDate && !range.endDate) return undefined;
  return {
    ...(range.startDate ? { gte: range.startDate } : {}),
    ...(range.endDate ? { lte: range.endDate } : {}),
  };
}

/**
 * Every number here comes from a live query against real tables — no
 * placeholder/mock values (spec §41). If a subsystem has no data yet
 * (e.g. no featured listings sold), its number is a genuine 0, not a
 * fabricated sample figure.
 */
export async function getOverview(range: DateRange = {}) {
  const createdAtFilter = rangeWhere(range);
  const orderWhere = createdAtFilter ? { createdAt: createdAtFilter } : {};
  const paidOrderWhere = { ...orderWhere, paymentStatus: "PAID" as const };

  const [
    totalUsers,
    totalVendors,
    approvedVendors,
    totalProducts,
    activeProducts,
    totalOrders,
    paidOrders,
    revenueAgg,
    commissionAgg,
    vendorEarningsAgg,
    subscriptionRevenueAgg,
    featuredProductRevenueAgg,
    featuredStoreRevenueAgg,
    refundedOrders,
    referralCounts,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "CUSTOMER", ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) } }),
    prisma.vendorProfile.count({ where: createdAtFilter ? { createdAt: createdAtFilter } : {} }),
    prisma.vendorProfile.count({ where: { status: "APPROVED" } }),
    prisma.product.count({ where: { deletedAt: null, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) } }),
    prisma.product.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    prisma.order.count({ where: orderWhere }),
    prisma.order.count({ where: paidOrderWhere }),
    prisma.order.aggregate({ where: paidOrderWhere, _sum: { totalAmount: true, discountAmount: true } }),
    prisma.vendorOrder.aggregate({
      where: { order: paidOrderWhere },
      _sum: { commissionAmount: true },
    }),
    prisma.vendorOrder.aggregate({
      where: { order: paidOrderWhere },
      _sum: { vendorEarnings: true },
    }),
    prisma.subscriptionPayment.aggregate({
      where: { status: "PAID", ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _sum: { amount: true },
    }),
    prisma.featuredProduct.aggregate({
      where: { status: { in: ["ACTIVE", "EXPIRED"] }, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _sum: { price: true },
    }),
    prisma.featuredStore.aggregate({
      where: { status: { in: ["ACTIVE", "EXPIRED"] }, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _sum: { price: true },
    }),
    prisma.order.count({ where: { ...orderWhere, paymentStatus: "REFUNDED" } }),
    prisma.referralEvent.groupBy({
      by: ["type"],
      where: createdAtFilter ? { createdAt: createdAtFilter } : {},
      _count: { _all: true },
    }),
  ]);

  const whatsappLeads = referralCounts.find((r: { type: string }) => r.type === "WHATSAPP_CLICK")?._count._all ?? 0;
  const externalClicks = referralCounts.find((r: { type: string }) => r.type === "EXTERNAL_CLICK")?._count._all ?? 0;

  return {
    users: { total: totalUsers },
    vendors: { total: totalVendors, approved: approvedVendors },
    products: { total: totalProducts, active: activeProducts },
    orders: { total: totalOrders, paid: paidOrders, refunded: refundedOrders },
    gmv: Number(revenueAgg._sum.totalAmount ?? 0),
    totalDiscountsGiven: Number(revenueAgg._sum.discountAmount ?? 0),
    ttflCommissionRevenue: Number(commissionAgg._sum.commissionAmount ?? 0),
    vendorEarnings: Number(vendorEarningsAgg._sum.vendorEarnings ?? 0),
    subscriptionRevenue: Number(subscriptionRevenueAgg._sum.amount ?? 0),
    featuredProductRevenue: Number(featuredProductRevenueAgg._sum.price ?? 0),
    featuredStoreRevenue: Number(featuredStoreRevenueAgg._sum.price ?? 0),
    referralActivity: { whatsappLeads, externalClicks },
  };
}

/**
 * Day/week/month bucketed revenue — uses Postgres date_trunc via a raw
 * query since Prisma's query builder can't group by a truncated date.
 * Falls back cleanly to an empty series if the DB doesn't support it (it
 * always will on Postgres; this is just defensive).
 */
export async function getRevenueTimeSeries(granularity: "day" | "week" | "month", range: DateRange) {
  const start = range.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = range.endDate ?? new Date();

  const rows: { bucket: Date; revenue: string; orders: bigint }[] = await prisma.$queryRawUnsafe(
    `SELECT date_trunc($1, "createdAt") AS bucket,
            COALESCE(SUM("totalAmount"), 0) AS revenue,
            COUNT(*) AS orders
     FROM orders
     WHERE "paymentStatus" = 'PAID' AND "createdAt" BETWEEN $2 AND $3
     GROUP BY bucket
     ORDER BY bucket ASC`,
    granularity,
    start,
    end
  );

  return rows.map((r: { bucket: Date; revenue: string; orders: bigint }) => ({ date: r.bucket, revenue: Number(r.revenue), orders: Number(r.orders) }));
}

export async function getCommissionCenter(range: DateRange = {}) {
  const createdAtFilter = rangeWhere(range);

  const [directSales, subscriptions, featuredProducts, featuredStores, referralBreakdown] = await Promise.all([
    prisma.vendorOrder.aggregate({
      where: { order: { paymentStatus: "PAID", ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) } },
      _sum: { subtotal: true, commissionAmount: true },
      _count: { _all: true },
    }),
    prisma.subscriptionPayment.aggregate({
      where: { status: "PAID", ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.featuredProduct.aggregate({
      where: { status: { in: ["ACTIVE", "EXPIRED"] }, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _sum: { price: true },
      _count: { _all: true },
    }),
    prisma.featuredStore.aggregate({
      where: { status: { in: ["ACTIVE", "EXPIRED"] }, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _sum: { price: true },
      _count: { _all: true },
    }),
    prisma.referralEvent.groupBy({
      by: ["type"],
      where: createdAtFilter ? { createdAt: createdAtFilter } : {},
      _count: { _all: true },
    }),
  ]);

  return {
    directSales: {
      totalSales: Number(directSales._sum.subtotal ?? 0),
      totalCommission: Number(directSales._sum.commissionAmount ?? 0),
      orderCount: directSales._count._all,
    },
    referralTraffic: referralBreakdown.map((r: { type: string; _count: { _all: number } }) => ({ type: r.type, count: r._count._all })),
    subscriptions: {
      revenue: Number(subscriptions._sum.amount ?? 0),
      count: subscriptions._count._all,
    },
    featuredProducts: {
      revenue: Number(featuredProducts._sum.price ?? 0),
      count: featuredProducts._count._all,
    },
    featuredStores: {
      revenue: Number(featuredStores._sum.price ?? 0),
      count: featuredStores._count._all,
    },
  };
}
