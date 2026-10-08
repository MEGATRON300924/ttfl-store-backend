import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import type { VendorTier } from "@prisma/client";

export type StorefrontConfig = {
  version: number;
  theme: { preset: "CLASSIC" | "DARK" | "MINIMAL"; accent: string; background: string; text: string };
  banner: { enabled: boolean; imageUrl: string | null; height: number; positionX: number; positionY: number; overlay: number; title: string; subtitle: string; titlePosition: "LEFT" | "CENTER" | "RIGHT"; showLogo: boolean };
  layout: { desktopColumns: 2 | 3 | 4 | 5; mobileColumns: 1 | 2; productLayout: "GRID" | "CAROUSEL" | "LIST"; cardStyle: "STANDARD" | "COMPACT" | "MINIMAL"; imageRatio: "SQUARE" | "PORTRAIT" | "LANDSCAPE"; showDescription: boolean; showRatings: boolean; showDiscountBadges: boolean; showStock: boolean };
  sections: Array<{ id: string; type: "FEATURED" | "BEST_SELLERS" | "CATEGORY" | "PRODUCTS" | "BANNER" | "ABOUT" | "HOURS"; title: string; enabled: boolean; categoryId?: string | null; productIds?: string[]; banner?: { imageUrl: string | null; height: number; positionX: number; positionY: number; overlay: number; title: string; subtitle: string } }>;
  contact: { showWhatsApp: boolean; showLocation: boolean; showEmail: boolean };
};

const DEFAULT_CONFIG: StorefrontConfig = {
  version: 1,
  theme: { preset: "CLASSIC", accent: "#E8622C", background: "#F8FAFC", text: "#111827" },
  banner: { enabled: true, imageUrl: null, height: 360, positionX: 50, positionY: 50, overlay: 35, title: "", subtitle: "", titlePosition: "LEFT", showLogo: true },
  layout: { desktopColumns: 4, mobileColumns: 2, productLayout: "GRID", cardStyle: "STANDARD", imageRatio: "SQUARE", showDescription: false, showRatings: true, showDiscountBadges: true, showStock: false },
  sections: [
    { id: "about", type: "ABOUT", title: "About this store", enabled: true },
    { id: "products", type: "PRODUCTS", title: "Shop this store", enabled: true, productIds: [] },
    { id: "hours", type: "HOURS", title: "Business hours", enabled: true },
  ],
  contact: { showWhatsApp: true, showLocation: true, showEmail: false },
};

function cloneDefault(): StorefrontConfig { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as StorefrontConfig; }

function normalizeConfig(input: unknown): StorefrontConfig {
  const base = cloneDefault();
  if (!input || typeof input !== "object") return base;
  const value = input as Partial<StorefrontConfig>;
  if (value.theme) base.theme = { ...base.theme, ...value.theme };
  if (value.banner) base.banner = { ...base.banner, ...value.banner };
  if (value.layout) base.layout = { ...base.layout, ...value.layout };
  if (Array.isArray(value.sections)) base.sections = value.sections.slice(0, 30).map((section) => ({ ...section, id: String(section.id || randomBytes(6).toString("hex")) })) as StorefrontConfig["sections"];
  if (value.contact) base.contact = { ...base.contact, ...value.contact };
  base.version = 1;
  return base;
}

let ready = false;
export async function ensureStoreBuilderTables() {
  if (ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS store_front_configs (id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,config JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS store_builder_entitlements (id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,permanent BOOLEAN NOT NULL DEFAULT FALSE,source TEXT NOT NULL,granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  ready = true;
}

async function vendorForUser(userId: string) { return getVendorProfileForUser(userId); }

async function ensurePermanentFromPaidHistory(vendorId: string) {
  const paid = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT sp.id FROM subscription_payments sp INNER JOIN vendor_subscriptions vs ON vs.id=sp.subscription_id WHERE vs.vendor_id=$1 AND sp.status='PAID' AND sp.amount>0 LIMIT 1`,
    vendorId,
  );
  if (!paid[0]) return false;
  await prisma.$executeRawUnsafe(
    `INSERT INTO store_builder_entitlements(id,vendor_id,permanent,source) VALUES($1,$2,TRUE,'DIRECT_PURCHASE') ON CONFLICT(vendor_id) DO UPDATE SET permanent=TRUE,source='DIRECT_PURCHASE',updated_at=NOW()`,
    randomBytes(16).toString("hex"), vendorId,
  );
  return true;
}

async function hasActiveGift(userId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM affiliate_vendor_rewards WHERE referred_user_id=$1 AND status='CLAIMED' AND redeemed_at IS NULL AND expires_at > NOW() LIMIT 1`,
    userId,
  );
  return Boolean(rows[0]);
}

export async function getBuilderAccess(userId: string) {
  await ensureStoreBuilderTables();
  const vendor = await vendorForUser(userId);
  const permanent = await ensurePermanentFromPaidHistory(vendor.id);
  if (permanent) return { allowed: true, permanent: true, reason: "DIRECT_PURCHASE" as const };
  if (await hasActiveGift(userId)) return { allowed: true, permanent: false, reason: "GIFT" as const };
  return { allowed: false, permanent: false, reason: "NONE" as const };
}

export async function getConfig(userId: string) {
  const vendor = await vendorForUser(userId);
  const access = await getBuilderAccess(userId);
  if (!access.allowed) throw AppError.forbidden("Store Builder is available on paid vendor plans.", "STORE_BUILDER_PLAN_REQUIRED");
  await ensureStoreBuilderTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ config: unknown; version: number }>>(`SELECT config,version FROM store_front_configs WHERE vendor_id=$1 LIMIT 1`, vendor.id);
  return { config: normalizeConfig(rows[0]?.config), version: Number(rows[0]?.version ?? 1), access, vendorId: vendor.id, storeSlug: vendor.storeSlug };
}

export async function saveConfig(userId: string, input: unknown) {
  const vendor = await vendorForUser(userId);
  const access = await getBuilderAccess(userId);
  if (!access.allowed) throw AppError.forbidden("Store Builder is available on paid vendor plans.", "STORE_BUILDER_PLAN_REQUIRED");
  const config = normalizeConfig(input);
  if (!/^#[0-9a-fA-F]{6}$/.test(config.theme.accent)) throw AppError.badRequest("Accent color must be a valid hex color", "INVALID_ACCENT_COLOR");
  config.layout.desktopColumns = ([2,3,4,5] as number[]).includes(config.layout.desktopColumns) ? config.layout.desktopColumns : 4;
  config.layout.mobileColumns = ([1,2] as number[]).includes(config.layout.mobileColumns) ? config.layout.mobileColumns : 2;
  await ensureStoreBuilderTables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO store_front_configs(id,vendor_id,config,version) VALUES($1,$2,$3::jsonb,1) ON CONFLICT(vendor_id) DO UPDATE SET config=EXCLUDED.config,version=store_front_configs.version+1,updated_at=NOW()`,
    randomBytes(16).toString("hex"), vendor.id, JSON.stringify(config),
  );
  return getConfig(userId);
}

export async function getPublicConfig(vendorId: string) {
  await ensureStoreBuilderTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ config: unknown; version: number }>>(`SELECT config,version FROM store_front_configs WHERE vendor_id=$1 LIMIT 1`, vendorId);
  return { config: normalizeConfig(rows[0]?.config), version: Number(rows[0]?.version ?? 1) };
}

export async function grantPermanentEntitlement(vendorId: string, source: "DIRECT_PURCHASE" | "ADMIN") {
  await ensureStoreBuilderTables();
  await prisma.$executeRawUnsafe(`INSERT INTO store_builder_entitlements(id,vendor_id,permanent,source) VALUES($1,$2,TRUE,$3) ON CONFLICT(vendor_id) DO UPDATE SET permanent=TRUE,source=$3,updated_at=NOW()`, randomBytes(16).toString("hex"), vendorId, source);
}

export function isPaidTier(tier: VendorTier) { return tier !== "FREE"; }
export { DEFAULT_CONFIG };
