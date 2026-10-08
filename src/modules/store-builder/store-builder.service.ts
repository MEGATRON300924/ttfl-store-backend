import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import type { VendorTier } from "@prisma/client";

export type StorefrontConfig = {
  version: number;
  theme: {
    preset: "CLASSIC" | "DARK" | "MINIMAL";
    accent: string;
    background: string;
    text: string;
    headerBackground: string;
    sidebarBackground: string;
    navigation: "SIDE" | "TOP";
    surface: "SOLID" | "GLASS" | "FLAT";
  };
  banner: { enabled: boolean; imageUrl: string | null; height: number; positionX: number; positionY: number; overlay: number; title: string; subtitle: string; titlePosition: "LEFT" | "CENTER" | "RIGHT"; showLogo: boolean };
  layout: { desktopColumns: 2 | 3 | 4 | 5; mobileColumns: 1 | 2; productLayout: "GRID" | "CAROUSEL" | "LIST"; cardStyle: "STANDARD" | "COMPACT" | "MINIMAL"; imageRatio: "SQUARE" | "PORTRAIT" | "LANDSCAPE"; showDescription: boolean; showRatings: boolean; showDiscountBadges: boolean; showStock: boolean };
  sections: Array<{ id: string; type: "FEATURED" | "BEST_SELLERS" | "CATEGORY" | "PRODUCTS" | "BANNER" | "ABOUT" | "HOURS"; title: string; enabled: boolean; categoryId?: string | null; productIds?: string[]; banner?: { imageUrl: string | null; height: number; positionX: number; positionY: number; overlay: number; title: string; subtitle: string } }>;
  contact: { showWhatsApp: boolean; showLocation: boolean; showEmail: boolean };
  customHtml: { enabled: boolean; code: string };
};

const DEFAULT_CONFIG: StorefrontConfig = {
  version: 1,
  theme: {
    preset: "CLASSIC",
    accent: "#E8622C",
    background: "#F8FAFC",
    text: "#111827",
    headerBackground: "#FFFFFF",
    sidebarBackground: "#111827",
    navigation: "SIDE",
    surface: "SOLID",
  },
  banner: { enabled: true, imageUrl: null, height: 360, positionX: 50, positionY: 50, overlay: 35, title: "", subtitle: "", titlePosition: "LEFT", showLogo: true },
  layout: { desktopColumns: 4, mobileColumns: 2, productLayout: "GRID", cardStyle: "STANDARD", imageRatio: "SQUARE", showDescription: false, showRatings: true, showDiscountBadges: true, showStock: false },
  sections: [
    { id: "about", type: "ABOUT", title: "About this store", enabled: true },
    { id: "products", type: "PRODUCTS", title: "Shop this store", enabled: true, productIds: [] },
    { id: "hours", type: "HOURS", title: "Business hours", enabled: true },
  ],
  contact: { showWhatsApp: true, showLocation: true, showEmail: false },
  customHtml: { enabled: false, code: "" },
};

function cloneDefault(): StorefrontConfig { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as StorefrontConfig; }

const ALLOWED_HTML_TAGS = new Set([
  "a","article","aside","b","blockquote","br","button","code","div","em","figure","figcaption",
  "footer","h1","h2","h3","h4","h5","h6","header","hr","i","img","label","li","main","nav",
  "ol","p","section","small","span","strong","table","tbody","td","tfoot","th","thead","tr",
  "u","ul","pre"
]);

function sanitizeCustomHtml(input: unknown) {
  const value = typeof input === "string" ? input : "";
  if (!value.trim()) return "";
  let html = value.slice(0, 60000)
    .replace(/<!--[\\s\\S]*?-->/g, "")
    .replace(/<\\/?style\\b[^>]*>[\\s\\S]*?<\\/?style\\s*>/gi, "")
    .replace(/<\\s*(script|iframe|object|embed|applet|base|meta|link|form|input|textarea|select|option|button)\\b[^>]*>[\\s\\S]*?<\\/\\s*\\1\\s*>/gi, "")
    .replace(/<\\s*(script|iframe|object|embed|applet|base|meta|link|form|input|textarea|select|option|button)\\b[^>]*\\/?\\s*>/gi, "");
  html = html.replace(/<\\/?([a-z0-9-]+)([^>]*)>/gi, (full, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) return "";
    let attrs = String(rawAttrs || "");
    attrs = attrs.replace(/\\s+on[a-z-]+\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)/gi, "");
    attrs = attrs.replace(/\\s+(href|src)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))/gi, (_m, name, a, b, d) => {
      const url = String(a ?? b ?? d ?? "").trim();
      if (!/^(https?:|mailto:|tel:|#|\\/)/i.test(url)) return "";
      return ` ${name}="${url.replace(/"/g, "&quot;")}"`;
    });
    attrs = attrs.replace(/\\s+style\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))/gi, (_m, a, b, d) => {
      const style = String(a ?? b ?? d ?? "")
        .replace(/url\\s*\\(/gi, "")
        .replace(/expression\\s*\\(/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/@import/gi, "");
      return style.trim() ? ` style="${style.replace(/"/g, "&quot;")}"` : "";
    });
    attrs = attrs.replace(/\\s+(id|class|title|alt|aria-[a-z-]+|data-[a-z0-9-]+)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))/gi, (_m, name, a, b, d) => {
      const value = String(a ?? b ?? d ?? "");
      return ` ${name}="${value.replace(/"/g, "&quot;")}"`;
    });
    return `<${full.startsWith("</") ? "/" : ""}${tag}${full.startsWith("</") ? "" : attrs}>`;
  });
  return html.trim();
}

function normalizeConfig(input: unknown): StorefrontConfig {
  const base = cloneDefault();
  if (!input || typeof input !== "object") return base;
  const value = input as Partial<StorefrontConfig>;
  if (value.theme) base.theme = { ...base.theme, ...value.theme };
  if (value.banner) base.banner = { ...base.banner, ...value.banner };
  if (value.layout) base.layout = { ...base.layout, ...value.layout };
  if (Array.isArray(value.sections)) base.sections = value.sections.slice(0, 30).map((section) => ({ ...section, id: String(section.id || randomBytes(6).toString("hex")) })) as StorefrontConfig["sections"];
  if (value.contact) base.contact = { ...base.contact, ...value.contact };
  if (value.customHtml && typeof value.customHtml === "object") {
    base.customHtml = {
      enabled: Boolean(value.customHtml.enabled),
      code: sanitizeCustomHtml(value.customHtml.code),
    };
  }
  base.theme.navigation = value.theme?.navigation === "TOP" ? "TOP" : "SIDE";
  base.theme.surface = value.theme?.surface === "GLASS" || value.theme?.surface === "FLAT" ? value.theme.surface : "SOLID";
  base.version = 2;
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

async function hasPermanentEntitlement(vendorId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ permanent: boolean }>>(
    `SELECT permanent FROM store_builder_entitlements WHERE vendor_id=$1 AND permanent=TRUE LIMIT 1`,
    vendorId,
  );
  return Boolean(rows[0]?.permanent);
}

async function ensurePermanentFromPaidHistory(vendorId: string) {
  const paid = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT sp.id FROM subscription_payments sp INNER JOIN vendor_subscriptions vs ON vs.id=sp."subscriptionId" WHERE vs."vendorId"=$1 AND sp.status='PAID' AND sp.amount>0 LIMIT 1`,
    vendorId,
  );
  if (!paid[0]) return false;
  await prisma.$executeRawUnsafe(
    `INSERT INTO store_builder_entitlements(id,vendor_id,permanent,source) VALUES($1,$2,TRUE,'DIRECT_PURCHASE') ON CONFLICT(vendor_id) DO UPDATE SET permanent=TRUE,source='DIRECT_PURCHASE',updated_at=NOW()`,
    randomBytes(16).toString("hex"), vendorId,
  );
  return true;
}

async function ensurePermanentFromActivePaidPlan(vendorId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT vs.id
     FROM vendor_subscriptions vs
     INNER JOIN vendor_plans vp ON vp.id=vs."planId"
     WHERE vs."vendorId"=$1
       AND vs.status='ACTIVE'
       AND vp.tier <> 'FREE'
       AND vp.price > 0
     LIMIT 1`,
    vendorId,
  );
  if (!rows[0]) return false;
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

  // A previously granted permanent entitlement must survive plan expiry/cancellation.
  if (await hasPermanentEntitlement(vendor.id)) {
    return { allowed: true, permanent: true, reason: "DIRECT_PURCHASE" as const };
  }

  // Backfill permanent access for vendors with a recorded successful payment.
  const paidHistory = await ensurePermanentFromPaidHistory(vendor.id);
  if (paidHistory) {
    return { allowed: true, permanent: true, reason: "DIRECT_PURCHASE" as const };
  }

  // Also backfill immediately for an active paid plan. This covers existing Enterprise/
  // Pro vendors whose subscription payment history predates Store Builder.
  const activePaidPlan = await ensurePermanentFromActivePaidPlan(vendor.id);
  if (activePaidPlan) {
    return { allowed: true, permanent: true, reason: "DIRECT_PURCHASE" as const };
  }

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
