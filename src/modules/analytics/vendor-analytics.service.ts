import { prisma } from "@/lib/prisma";

type DateRange = { startDate?: Date; endDate?: Date };

function rangeWhere(range: DateRange) {
  if (!range.startDate && !range.endDate) return undefined;
  return {
    ...(range.startDate ? { gte: range.startDate } : {}),
    ...(range.endDate ? { lte: range.endDate } : {}),
  };
}

/** Everything here is scoped by vendorId in every query — a vendor can never see another vendor's numbers through this service. */
export async function getVendorOverview(vendorId: string, range: DateRange = {}) {
  const createdAtFilter = rangeWhere(range);

  const [vendor, productViewsAgg, referralCounts, vendorOrders, orderCount] = await Promise.all([
    prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendorId }, select: { viewCount: true } }),
    prisma.product.aggregate({ where: { vendorId, deletedAt: null }, _sum: { viewCount: true } }),
    prisma.referralEvent.groupBy({
      by: ["type"],
      where: { vendorId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _count: { _all: true },
    }),
    prisma.vendorOrder.findMany({
      where: {
        vendorId,
        order: { paymentStatus: "PAID", ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      },
      select: { vendorEarnings: true, subtotal: true },
    }),
    prisma.vendorOrder.count({
      where: { vendorId, order: { paymentStatus: "PAID", ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) } },
    }),
  ]);

  const revenue = vendorOrders.reduce((sum: number, vo: { vendorEarnings: unknown }) => sum + Number(vo.vendorEarnings), 0);
  const grossSales = vendorOrders.reduce((sum: number, vo: { subtotal: unknown }) => sum + Number(vo.subtotal), 0);
  const productViews = productViewsAgg._sum.viewCount ?? 0;
  const whatsappClicks = referralCounts.find((r: { type: string }) => r.type === "WHATSAPP_CLICK")?._count._all ?? 0;
  const externalClicks = referralCounts.find((r: { type: string }) => r.type === "EXTERNAL_CLICK")?._count._all ?? 0;

  // Conversion rate is a rough signal (orders / product views), not a
  // rigorous funnel metric — there's no session-level "viewed then
  // bought" linkage in this schema yet.
  const conversionRate = productViews > 0 ? Math.round((orderCount / productViews) * 10000) / 100 : 0;

  return {
    storeViews: vendor.viewCount,
    productViews,
    whatsappClicks,
    externalClicks,
    orders: orderCount,
    revenue,
    grossSales,
    conversionRate,
  };
}

export async function getBestPerformingProducts(vendorId: string, limit = 10) {
  const items = await prisma.orderItem.groupBy({
    by: ["productId", "productName"],
    where: { vendorOrder: { vendorId, order: { paymentStatus: "PAID" } } },
    _sum: { quantity: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: "desc" } },
    take: limit,
  });

  return items.map((i: { productId: string; productName: string; _sum: { quantity: number | null; lineTotal: unknown } }) => ({
    productId: i.productId,
    productName: i.productName,
    unitsSold: i._sum.quantity ?? 0,
    revenue: Number(i._sum.lineTotal ?? 0),
  }));
}

export async function getTrafficSources(vendorId: string, range: DateRange = {}) {
  const createdAtFilter = rangeWhere(range);
  const bySource = await prisma.referralEvent.groupBy({
    by: ["source"],
    where: { vendorId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
    _count: { _all: true },
  });
  return bySource.map((s: { source: string | null; _count: { _all: number } }) => ({ source: s.source ?? "unknown", count: s._count._all }));
}
