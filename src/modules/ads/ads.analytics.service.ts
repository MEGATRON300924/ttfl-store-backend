import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { AppError } from "@/utils/app-error";
import { ensureAdTables } from "./ads.service";

export async function getCampaignAnalyticsSeries(userId: string, campaignId: string, range: "24h" | "7d" | "30d") {
  await ensureAdTables();
  const vendor = await getVendorProfileForUser(userId);
  const campaign = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM ad_campaigns WHERE id=$1 AND vendor_id=$2 LIMIT 1`, campaignId, vendor.id);
  if (!campaign[0]) throw AppError.notFound("Ad campaign not found");

  const hours = range === "24h" ? 24 : range === "7d" ? 168 : 720;
  const bucket = range === "24h" ? "hour" : "day";
  const rows = await prisma.$queryRawUnsafe<Array<{ bucket: Date; event_type: string; count: number }>>(`
    SELECT date_trunc($2, created_at) AS bucket, event_type, COUNT(*)::int AS count
    FROM ad_events
    WHERE campaign_id=$1 AND created_at >= NOW() - ($3 * INTERVAL '1 hour')
    GROUP BY 1,2
    ORDER BY 1 ASC
  `, campaignId, bucket, hours);

  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = new Date(row.bucket).toISOString();
    const values = map.get(key) ?? {};
    values[row.event_type] = Number(row.count);
    map.set(key, values);
  }

  return Array.from(map.entries()).map(([timestamp, values]) => ({
    timestamp,
    impressions: values.IMPRESSION ?? 0,
    clicks: values.CLICK ?? 0,
    destinationViews: values.DESTINATION_VIEW ?? 0,
    checkoutStarts: values.CHECKOUT_START ?? 0,
    purchases: values.PURCHASE ?? 0,
    bookings: values.BOOKING ?? 0,
  }));
}
