import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const SETTING_KEYS = {
  FEATURED_HOMEPAGE_PRICE_PER_DAY:"featured_homepage_price_per_day", FEATURED_TRENDING_PRICE_PER_DAY:"featured_trending_price_per_day", FEATURED_CATEGORY_PRICE_PER_DAY:"featured_category_price_per_day", FEATURED_SEARCH_PRICE_PER_DAY:"featured_search_price_per_day", FEATURED_STORE_PRICE_PER_DAY:"featured_store_price_per_day", MIN_PAYOUT_AMOUNT:"min_payout_amount", WHATSAPP_ADMIN_NUMBERS:"whatsapp_admin_numbers", DELIVERY_FEE:"delivery_fee",
  AFFILIATE_PROGRAM_ENABLED:"affiliate_program_enabled", AFFILIATE_CUSTOMER_REFERRALS_ENABLED:"affiliate_customer_referrals_enabled", AFFILIATE_VENDOR_REFERRALS_ENABLED:"affiliate_vendor_referrals_enabled", AFFILIATE_VENDOR_REWARD_ENABLED:"affiliate_vendor_reward_enabled", AFFILIATE_VENDOR_REWARD_TIER:"affiliate_vendor_reward_tier", AFFILIATE_VENDOR_REWARD_MONTHS:"affiliate_vendor_reward_months", AFFILIATE_VENDOR_QUALIFICATION:"affiliate_vendor_qualification",
} as const;
const DEFAULTS:Record<string,string> = {
  featured_homepage_price_per_day:"2000", featured_trending_price_per_day:"1500", featured_category_price_per_day:"1000", featured_search_price_per_day:"1000", featured_store_price_per_day:"1500", min_payout_amount:"5000", whatsapp_admin_numbers:"", delivery_fee:"0",
  affiliate_program_enabled:"true", affiliate_customer_referrals_enabled:"true", affiliate_vendor_referrals_enabled:"true", affiliate_vendor_reward_enabled:"true", affiliate_vendor_reward_tier:"PRO", affiliate_vendor_reward_months:"1", affiliate_vendor_qualification:"APPROVED_VENDOR",
};
const EDITABLE_KEYS=new Set<string>(Object.values(SETTING_KEYS));
export async function getSettingNumber(key:string){const row=await prisma.platformSetting.findUnique({where:{key}});return row?Number(row.value):Number(DEFAULTS[key]??0);}
export async function getSetting(key:string){const row=await prisma.platformSetting.findUnique({where:{key}});return row?.value??DEFAULTS[key]??"";}
export async function getWhatsAppAdminNumbers(){const value=await getSetting(SETTING_KEYS.WHATSAPP_ADMIN_NUMBERS);return value.split(/[,\n]/).map(n=>n.trim()).filter(Boolean).map(n=>n.replace(/\D/g,"")).filter(n=>n.length>=7);}
export async function getAllSettings(){const rows=await prisma.platformSetting.findMany({where:{key:{in:[...EDITABLE_KEYS]}}});const map={...DEFAULTS};for(const row of rows)map[row.key]=row.value;return map;}
export async function setSetting(key:string,value:string){if(!EDITABLE_KEYS.has(key))throw AppError.badRequest("That platform setting cannot be changed","SETTING_NOT_EDITABLE");if(key===SETTING_KEYS.DELIVERY_FEE&&(!Number.isFinite(Number(value))||Number(value)<0))throw AppError.badRequest("Delivery fee must be a valid amount of ₦0 or more","INVALID_DELIVERY_FEE");return prisma.platformSetting.upsert({where:{key},create:{key,value},update:{value}});}


export type BlackFridayConfig = {
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  headline: string;
  subheadline: string;
  discountMode: "vendor" | "admin" | "vendor-approval";
  participation: "both" | "vendors" | "ttfl";
};

const BLACK_FRIDAY_DEFAULTS: BlackFridayConfig = {
  enabled: false,
  startsAt: "2026-11-26T23:00:00.000Z",
  endsAt: "2026-11-27T23:00:00.000Z",
  headline: "Black Friday at TTFL Store",
  subheadline: "Discover limited-time deals from Nigerian sellers.",
  discountMode: "vendor-approval",
  participation: "both",
};

const BLACK_FRIDAY_KEYS = {
  enabled: "black_friday_enabled",
  startsAt: "black_friday_starts_at",
  endsAt: "black_friday_ends_at",
  headline: "black_friday_headline",
  subheadline: "black_friday_subheadline",
  discountMode: "black_friday_discount_mode",
  participation: "black_friday_participation",
} as const;

export async function getBlackFridayConfig(): Promise<BlackFridayConfig> {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: Object.values(BLACK_FRIDAY_KEYS) } } });
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const enabled = stored[BLACK_FRIDAY_KEYS.enabled] ?? String(BLACK_FRIDAY_DEFAULTS.enabled);
  const discountMode = stored[BLACK_FRIDAY_KEYS.discountMode] ?? BLACK_FRIDAY_DEFAULTS.discountMode;
  const participation = stored[BLACK_FRIDAY_KEYS.participation] ?? BLACK_FRIDAY_DEFAULTS.participation;
  return {
    enabled: enabled === "true",
    startsAt: stored[BLACK_FRIDAY_KEYS.startsAt] ?? BLACK_FRIDAY_DEFAULTS.startsAt,
    endsAt: stored[BLACK_FRIDAY_KEYS.endsAt] ?? BLACK_FRIDAY_DEFAULTS.endsAt,
    headline: stored[BLACK_FRIDAY_KEYS.headline] ?? BLACK_FRIDAY_DEFAULTS.headline,
    subheadline: stored[BLACK_FRIDAY_KEYS.subheadline] ?? BLACK_FRIDAY_DEFAULTS.subheadline,
    discountMode: (["vendor", "admin", "vendor-approval"].includes(discountMode) ? discountMode : BLACK_FRIDAY_DEFAULTS.discountMode) as BlackFridayConfig["discountMode"],
    participation: (["both", "vendors", "ttfl"].includes(participation) ? participation : BLACK_FRIDAY_DEFAULTS.participation) as BlackFridayConfig["participation"],
  };
}

export async function saveBlackFridayConfig(config: BlackFridayConfig) {
  const values: Record<string, string> = {
    [BLACK_FRIDAY_KEYS.enabled]: String(config.enabled),
    [BLACK_FRIDAY_KEYS.startsAt]: config.startsAt,
    [BLACK_FRIDAY_KEYS.endsAt]: config.endsAt,
    [BLACK_FRIDAY_KEYS.headline]: config.headline,
    [BLACK_FRIDAY_KEYS.subheadline]: config.subheadline,
    [BLACK_FRIDAY_KEYS.discountMode]: config.discountMode,
    [BLACK_FRIDAY_KEYS.participation]: config.participation,
  };
  await prisma.$transaction(Object.entries(values).map(([key, value]) => prisma.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })));
  return getBlackFridayConfig();
}
