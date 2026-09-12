import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { initializeTransaction, verifyTransaction } from "@/lib/paystack";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { AppError } from "@/utils/app-error";

export const AD_PRICES: Record<number, number> = { 1: 500, 7: 2500, 30: 5500, 60: 10000 };
const OBJECTIVES = ["STORE_VISITS", "PRODUCT_VIEWS", "SERVICE_BOOKINGS", "ORDERS", "STORE_PROMOTION", "SPECIAL_OFFER"];
const EVENTS = ["IMPRESSION", "CLICK", "DESTINATION_VIEW", "CHECKOUT_START", "PURCHASE", "BOOKING"];

export async function ensureAdTables() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ad_campaigns (id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,name TEXT NOT NULL,objective TEXT NOT NULL DEFAULT 'STORE_VISITS',target_type TEXT NOT NULL DEFAULT 'STORE',target_id TEXT,target_category TEXT,target_location TEXT,duration_days INTEGER NOT NULL,price NUMERIC(14,2) NOT NULL,payment_reference TEXT UNIQUE NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',start_at TIMESTAMPTZ,end_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK (duration_days IN (1,7,30,60)),CHECK (status IN ('DRAFT','PENDING_PAYMENT','PENDING_REVIEW','ACTIVE','PAUSED','EXPIRED','REJECTED','CANCELLED')),CHECK (target_type IN ('STORE','PRODUCT','SERVICE','COMING_SOON')))`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_status_check`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_status_check CHECK (status IN ('DRAFT','PENDING_PAYMENT','PENDING_REVIEW','ACTIVE','PAUSED','EXPIRED','REJECTED','CANCELLED'))`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ad_events (id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,event_type TEXT NOT NULL,visitor_key TEXT,metadata JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ad_campaigns_active_idx ON ad_campaigns(status,start_at,end_at)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ad_events_campaign_idx ON ad_events(campaign_id,event_type,created_at)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ad_events_visitor_idx ON ad_events(campaign_id,event_type,visitor_key,created_at)`);
}

export async function getAdPlans() { return Object.entries(AD_PRICES).map(([days, price]) => ({ durationDays: Number(days), price, label: Number(days) === 30 ? "Best Value" : undefined })); }

export async function createCampaign(userId: string, email: string, input: { name: string; objective: string; targetType: "STORE" | "PRODUCT" | "SERVICE" | "COMING_SOON"; targetId?: string; targetCategory?: string; targetLocation?: string; durationDays: 1 | 7 | 30 | 60 }) {
  await ensureAdTables();
  const vendor = await getVendorProfileForUser(userId);
  if (vendor.status !== "APPROVED") throw AppError.forbidden("Your store must be approved before advertising on TTFL");
  const price = AD_PRICES[input.durationDays];
  if (!price) throw AppError.badRequest("Invalid advertising duration");
  if (!OBJECTIVES.includes(input.objective)) throw AppError.badRequest("Invalid advertising objective");
  const targetId = input.targetType === "STORE" ? vendor.id : input.targetId;
  if (input.targetType !== "STORE" && !targetId) throw AppError.badRequest("A target is required for this campaign type");
  if (input.targetType === "PRODUCT" || input.targetType === "COMING_SOON") {
    const product = await prisma.product.findUnique({ where: { id: targetId! } });
    if (!product || product.vendorId !== vendor.id) throw AppError.forbidden("You can only advertise your own products");
  }
  if (input.targetType === "SERVICE") {
    const service = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM services WHERE id=$1 AND vendor_id=$2 LIMIT 1`, targetId, vendor.id);
    if (!service[0]) throw AppError.forbidden("You can only advertise your own services");
  }
  const name = input.name.trim();
  if (name.length < 2 || /https?:\/\//i.test(name)) throw AppError.badRequest("Please use a clear campaign name without links");
  const id = randomUUID();
  const reference = `ttfl_ad_${id}_${Date.now()}`;
  await prisma.$executeRawUnsafe(`INSERT INTO ad_campaigns (id,vendor_id,name,objective,target_type,target_id,target_category,target_location,duration_days,price,payment_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, vendor.id, name, input.objective, input.targetType, targetId, input.targetCategory?.trim().toLowerCase() ?? null, input.targetLocation?.trim() || null, input.durationDays, price, reference);
  const paystack = await initializeTransaction({ email, amountNaira: price, reference, callbackUrl: `${env.appUrl}/vendor/dashboard/ads/confirm`, metadata: { campaignId: id, kind: "ttfl_ad_campaign" } });
  return { campaign: await getCampaignForVendor(id, vendor.id), checkoutUrl: paystack.authorization_url, plans: await getAdPlans() };
}

async function getCampaignForVendor(id: string, vendorId: string) { const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM ad_campaigns WHERE id=$1 AND vendor_id=$2 LIMIT 1`, id, vendorId); if (!rows[0]) throw AppError.notFound("Ad campaign not found"); return rows[0]; }

export async function verifyCampaignPayment(userId: string, reference: string) {
  await ensureAdTables(); const vendor = await getVendorProfileForUser(userId);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM ad_campaigns WHERE payment_reference=$1 AND vendor_id=$2 LIMIT 1`, reference, vendor.id); const campaign = rows[0];
  if (!campaign) throw AppError.notFound("Ad campaign not found"); if (campaign.status !== "PENDING_PAYMENT") return campaign;
  const verification = await verifyTransaction(reference);
  if (verification.status !== "success") { await prisma.$executeRawUnsafe(`UPDATE ad_campaigns SET status='CANCELLED',updated_at=NOW() WHERE id=$1`, campaign.id); return { ...campaign, status: "CANCELLED" }; }
  const paidNaira = verification.amount / 100; if (Math.round(paidNaira) !== Math.round(Number(campaign.price))) throw AppError.badRequest("Payment amount mismatch", "AMOUNT_MISMATCH");
  await prisma.$executeRawUnsafe(`UPDATE ad_campaigns SET status='PENDING_REVIEW',updated_at=NOW() WHERE id=$1`, campaign.id);
  return getCampaignForVendor(campaign.id, vendor.id);
}

export async function listMyCampaigns(userId: string) { await ensureAdTables(); const vendor = await getVendorProfileForUser(userId); return prisma.$queryRawUnsafe<any[]>(`SELECT * FROM ad_campaigns WHERE vendor_id=$1 ORDER BY created_at DESC`, vendor.id); }
export async function recordEvent(campaignId: string, eventType: string, visitorKey?: string, metadata?: unknown) { await ensureAdTables(); if (!EVENTS.includes(eventType)) throw AppError.badRequest("Invalid ad event"); const active = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM ad_campaigns WHERE id=$1 AND status='ACTIVE' AND start_at<=NOW() AND end_at>NOW() LIMIT 1`, campaignId); if (!active[0]) throw AppError.badRequest("Ad campaign is not active", "AD_NOT_ACTIVE"); if (visitorKey && ["IMPRESSION", "CLICK", "DESTINATION_VIEW"].includes(eventType)) { const windowMinutes = eventType === "IMPRESSION" ? 30 : 5; const recent = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM ad_events WHERE campaign_id=$1 AND event_type=$2 AND visitor_key=$3 AND created_at>=NOW()-($4*INTERVAL '1 minute') LIMIT 1`, campaignId, eventType, visitorKey, windowMinutes); if (recent[0]) return { recorded: false, deduplicated: true }; } await prisma.$executeRawUnsafe(`INSERT INTO ad_events (id,campaign_id,event_type,visitor_key,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`, randomUUID(), campaignId, eventType, visitorKey ?? null, JSON.stringify(metadata ?? {})); return { recorded: true }; }
export async function recordConversionEvent(campaignId: string, eventType: "PURCHASE" | "BOOKING", metadata?: unknown) { await ensureAdTables(); const campaign = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM ad_campaigns WHERE id=$1 AND status NOT IN ('REJECTED','CANCELLED') AND COALESCE(end_at,NOW())>=NOW()-INTERVAL '30 days' LIMIT 1`, campaignId); if (!campaign[0]) return { recorded: false, reason: "campaign_not_attributable" }; await prisma.$executeRawUnsafe(`INSERT INTO ad_events (id,campaign_id,event_type,metadata) VALUES ($1,$2,$3,$4::jsonb)`, randomUUID(), campaignId, eventType, JSON.stringify(metadata ?? {})); return { recorded: true }; }
export async function getCampaignAnalytics(userId: string, campaignId: string) { await ensureAdTables(); const vendor = await getVendorProfileForUser(userId); const campaign = await getCampaignForVendor(campaignId, vendor.id); const rows = await prisma.$queryRawUnsafe<Array<{ event_type: string; count: number; revenue: number }>>(`SELECT event_type,COUNT(*)::int AS count,COALESCE(SUM(CASE WHEN event_type IN ('PURCHASE','BOOKING') THEN COALESCE((metadata->>'amount')::numeric,0) ELSE 0 END),0)::float AS revenue FROM ad_events WHERE campaign_id=$1 GROUP BY event_type`, campaignId); const metrics = Object.fromEntries(rows.map(r => [r.event_type, { count: Number(r.count), revenue: Number(r.revenue) }])); const impressions = metrics.IMPRESSION?.count ?? 0; const clicks = metrics.CLICK?.count ?? 0; const purchases = metrics.PURCHASE?.count ?? 0; const bookings = metrics.BOOKING?.count ?? 0; const revenue = (metrics.PURCHASE?.revenue ?? 0) + (metrics.BOOKING?.revenue ?? 0); const spend = Number(campaign.price); const conversions = purchases + bookings; return { campaign, metrics: { impressions, clicks, ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0, destinationViews: metrics.DESTINATION_VIEW?.count ?? 0, checkoutStarts: metrics.CHECKOUT_START?.count ?? 0, purchases, bookings, conversions, revenueGenerated: revenue, adSpend: spend, roas: spend ? Number((revenue / spend).toFixed(2)) : 0, conversionRate: clicks ? Number(((conversions / clicks) * 100).toFixed(2)) : 0 } }; }
export async function getActiveCampaignsForPlacement(targetType?: string, category?: string, location?: string) { await ensureAdTables(); return prisma.$queryRawUnsafe<any[]>(`SELECT a.*,vp."storeName" AS "storeName",vp."storeSlug" AS "storeSlug",vp."logoUrl" AS "storeLogoUrl",vp.verified AS "storeVerified",p.slug AS "productSlug",p.name AS "productName",s.slug AS "serviceSlug",s.title AS "serviceTitle" FROM ad_campaigns a JOIN vendor_profiles vp ON vp.id=a.vendor_id LEFT JOIN products p ON p.id=a.target_id AND a.target_type IN ('PRODUCT','COMING_SOON') LEFT JOIN services s ON s.id=a.target_id AND a.target_type='SERVICE' WHERE a.status='ACTIVE' AND a.start_at<=NOW() AND a.end_at>NOW() AND ($1='' OR a.target_type=$1) AND ($2='' OR a.target_category=$2 OR a.target_category IS NULL) AND ($3='' OR a.target_location ILIKE '%'||$3||'%' OR a.target_location IS NULL) ORDER BY a.created_at DESC LIMIT 20`, targetType ?? "", category?.toLowerCase() ?? "", location ?? ""); }
export async function boostCampaign(userId: string, campaignId: string, email: string) { const vendor = await getVendorProfileForUser(userId); const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT name,objective,target_type,target_id,target_category,target_location,duration_days FROM ad_campaigns WHERE id=$1 AND vendor_id=$2 AND status IN ('EXPIRED','CANCELLED','PAUSED','REJECTED') LIMIT 1`, campaignId, vendor.id); if (!rows[0]) throw AppError.badRequest("This campaign cannot be boosted"); return createCampaign(userId, email, { ...rows[0], durationDays: Number(rows[0].duration_days) as 1|7|30|60, targetType: rows[0].target_type }); }
export async function listPendingModeration() { await ensureAdTables(); return prisma.$queryRawUnsafe<any[]>(`SELECT a.*,vp."storeName" AS "storeName" FROM ad_campaigns a JOIN vendor_profiles vp ON vp.id=a.vendor_id WHERE a.status='PENDING_REVIEW' ORDER BY a.created_at ASC`); }
export async function moderateCampaign(campaignId: string, action: "APPROVE"|"REJECT") { await ensureAdTables(); const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM ad_campaigns WHERE id=$1 AND status='PENDING_REVIEW' LIMIT 1`,campaignId); if(!rows[0])throw AppError.notFound("Campaign awaiting moderation not found"); if(action==="REJECT"){await prisma.$executeRawUnsafe(`UPDATE ad_campaigns SET status='REJECTED',updated_at=NOW() WHERE id=$1`,campaignId);return{status:"REJECTED"};} const start=new Date(); const end=new Date(start.getTime()+Number(rows[0].duration_days)*86400000); await prisma.$executeRawUnsafe(`UPDATE ad_campaigns SET status='ACTIVE',start_at=$2,end_at=$3,updated_at=NOW() WHERE id=$1`,campaignId,start,end); return{status:"ACTIVE",start_at:start,end_at:end}; }
