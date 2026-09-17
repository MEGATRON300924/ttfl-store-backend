import type { Product } from "@prisma/client";

export type StoredVariation = {
  key?: string;
  label?: string;
  options?: Record<string, string>;
  price?: string | number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function getProductVariations(product: Product): StoredVariation[] {
  const specifications = asRecord(product.specifications);
  const raw = specifications?._variations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))).map((item) => ({
    key: typeof item.key === "string" ? item.key : undefined,
    label: typeof item.label === "string" ? item.label : undefined,
    options: asRecord(item.options) ? Object.fromEntries(Object.entries(item.options as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string> : undefined,
    price: typeof item.price === "number" || typeof item.price === "string" ? item.price : null,
  }));
}

export function resolveProductVariant(product: Product, variantKey?: string) {
  if (!variantKey) return null;
  const variant = getProductVariations(product).find((item) => item.key === variantKey);
  if (!variant) return null;
  const parsedPrice = variant.price === null || variant.price === undefined || variant.price === "" ? null : Number(variant.price);
  if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
    throw new Error(`Invalid price configured for variant ${variantKey}`);
  }
  return {
    key: variant.key ?? variantKey,
    label: variant.label ?? Object.values(variant.options ?? {}).join(" / "),
    options: variant.options ?? {},
    price: parsedPrice,
  };
}

export function resolveCheckoutUnitPrice(product: Product, variantKey: string | undefined, dealPrice?: number) {
  const variant = resolveProductVariant(product, variantKey);
  if (variantKey && !variant) {
    return { variant: null, unitPrice: null };
  }
  const basePrice = variant?.price ?? Number(product.price);
  return { variant, unitPrice: dealPrice ?? basePrice };
}
