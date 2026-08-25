import { prisma } from "@/lib/prisma";

export const SETTING_KEYS = {
  FEATURED_HOMEPAGE_PRICE_PER_DAY: "featured_homepage_price_per_day",
  FEATURED_TRENDING_PRICE_PER_DAY: "featured_trending_price_per_day",
  FEATURED_CATEGORY_PRICE_PER_DAY: "featured_category_price_per_day",
  FEATURED_SEARCH_PRICE_PER_DAY: "featured_search_price_per_day",
  FEATURED_STORE_PRICE_PER_DAY: "featured_store_price_per_day",
  MIN_PAYOUT_AMOUNT: "min_payout_amount",
} as const;

const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.FEATURED_HOMEPAGE_PRICE_PER_DAY]: "2000",
  [SETTING_KEYS.FEATURED_TRENDING_PRICE_PER_DAY]: "1500",
  [SETTING_KEYS.FEATURED_CATEGORY_PRICE_PER_DAY]: "1000",
  [SETTING_KEYS.FEATURED_SEARCH_PRICE_PER_DAY]: "1000",
  [SETTING_KEYS.FEATURED_STORE_PRICE_PER_DAY]: "1500",
  [SETTING_KEYS.MIN_PAYOUT_AMOUNT]: "5000",
};

export async function getSettingNumber(key: string): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  if (row) return Number(row.value);
  return Number(DEFAULTS[key] ?? 0);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.platformSetting.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function setSetting(key: string, value: string) {
  return prisma.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
