import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const SETTING_KEYS = {
  FEATURED_HOMEPAGE_PRICE_PER_DAY:"featured_homepage_price_per_day", FEATURED_TRENDING_PRICE_PER_DAY:"featured_trending_price_per_day", FEATURED_CATEGORY_PRICE_PER_DAY:"featured_category_price_per_day", FEATURED_SEARCH_PRICE_PER_DAY:"featured_search_price_per_day", FEATURED_STORE_PRICE_PER_DAY:"featured_store_price_per_day", MIN_PAYOUT_AMOUNT:"min_payout_amount", WHATSAPP_ADMIN_NUMBERS:"whatsapp_admin_numbers",
  AFFILIATE_PROGRAM_ENABLED:"affiliate_program_enabled", AFFILIATE_CUSTOMER_REFERRALS_ENABLED:"affiliate_customer_referrals_enabled", AFFILIATE_VENDOR_REFERRALS_ENABLED:"affiliate_vendor_referrals_enabled", AFFILIATE_VENDOR_REWARD_ENABLED:"affiliate_vendor_reward_enabled", AFFILIATE_VENDOR_REWARD_TIER:"affiliate_vendor_reward_tier", AFFILIATE_VENDOR_REWARD_MONTHS:"affiliate_vendor_reward_months", AFFILIATE_VENDOR_QUALIFICATION:"affiliate_vendor_qualification",
} as const;
const DEFAULTS:Record<string,string> = {
  featured_homepage_price_per_day:"2000", featured_trending_price_per_day:"1500", featured_category_price_per_day:"1000", featured_search_price_per_day:"1000", featured_store_price_per_day:"1500", min_payout_amount:"5000", whatsapp_admin_numbers:"",
  affiliate_program_enabled:"true", affiliate_customer_referrals_enabled:"true", affiliate_vendor_referrals_enabled:"true", affiliate_vendor_reward_enabled:"true", affiliate_vendor_reward_tier:"PRO", affiliate_vendor_reward_months:"1", affiliate_vendor_qualification:"APPROVED_VENDOR",
};
const EDITABLE_KEYS=new Set<string>(Object.values(SETTING_KEYS));
export async function getSettingNumber(key:string){const row=await prisma.platformSetting.findUnique({where:{key}});return row?Number(row.value):Number(DEFAULTS[key]??0);}
export async function getSetting(key:string){const row=await prisma.platformSetting.findUnique({where:{key}});return row?.value??DEFAULTS[key]??"";}
export async function getWhatsAppAdminNumbers(){const value=await getSetting(SETTING_KEYS.WHATSAPP_ADMIN_NUMBERS);return value.split(/[,\n]/).map(n=>n.trim()).filter(Boolean).map(n=>n.replace(/\D/g,"")).filter(n=>n.length>=7);}
export async function getAllSettings(){const rows=await prisma.platformSetting.findMany({where:{key:{in:[...EDITABLE_KEYS]}}});const map={...DEFAULTS};for(const row of rows)map[row.key]=row.value;return map;}
export async function setSetting(key:string,value:string){if(!EDITABLE_KEYS.has(key))throw AppError.badRequest("That platform setting cannot be changed","SETTING_NOT_EDITABLE");return prisma.platformSetting.upsert({where:{key},create:{key,value},update:{value}});}
