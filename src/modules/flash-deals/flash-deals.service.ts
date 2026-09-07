import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";

async function ensureTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS flash_deals (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, discount_percent NUMERIC(5,2) NOT NULL, sale_price NUMERIC(12,2) NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(vendor_id, product_id))`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS flash_deals_active_idx ON flash_deals(active, starts_at, ends_at)`);
}

export async function listActive() {
  await ensureTable();
  return prisma.$queryRawUnsafe<any[]>(`SELECT fd.id, fd.product_id AS "productId", fd.vendor_id AS "vendorId", fd.discount_percent AS "discountPercent", fd.sale_price AS "salePrice", fd.starts_at AS "startsAt", fd.ends_at AS "endsAt", p.name, p.slug, p.price, p.stock, pi.url AS "imageUrl" FROM flash_deals fd JOIN products p ON p.id = fd.product_id LEFT JOIN LATERAL (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position ASC LIMIT 1) pi ON true WHERE fd.active = true AND fd.starts_at <= NOW() AND fd.ends_at > NOW() AND p.status = 'ACTIVE' AND p.deleted_at IS NULL ORDER BY fd.ends_at ASC`);
}

export async function listMine(userId: string) {
  await ensureTable();
  const vendor = await getVendorProfileForUser(userId);
  return prisma.$queryRawUnsafe<any[]>(`SELECT fd.id, fd.product_id AS "productId", fd.discount_percent AS "discountPercent", fd.sale_price AS "salePrice", fd.starts_at AS "startsAt", fd.ends_at AS "endsAt", fd.active, p.name, p.price, p.stock FROM flash_deals fd JOIN products p ON p.id = fd.product_id WHERE fd.vendor_id = $1 ORDER BY fd.created_at DESC`, vendor.id);
}

export async function upsert(userId: string, input: { productId: string; discountPercent: number; startsAt: string; endsAt: string }) {
  await ensureTable();
  const vendor = await getVendorProfileForUser(userId);
  if (vendor.status !== "APPROVED") throw AppError.forbidden("Your store must be approved before creating flash deals");
  const product = await prisma.product.findFirst({ where: { id: input.productId, vendorId: vendor.id, deletedAt: null } });
  if (!product) throw AppError.notFound("Product not found in your store");
  if (input.discountPercent <= 0 || input.discountPercent >= 100) throw AppError.badRequest("Discount must be between 1% and 99%");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw AppError.badRequest("Flash deal end time must be after the start time");
  const salePrice = Number(product.price) * (1 - input.discountPercent / 100);
  await prisma.$executeRawUnsafe(`INSERT INTO flash_deals (id, vendor_id, product_id, discount_percent, sale_price, starts_at, ends_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT (vendor_id, product_id) DO UPDATE SET discount_percent=EXCLUDED.discount_percent, sale_price=EXCLUDED.sale_price, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, active=true, updated_at=NOW()`, randomUUID(), vendor.id, product.id, input.discountPercent, salePrice, startsAt, endsAt);
  return listMine(userId);
}

export async function remove(userId: string, id: string) {
  await ensureTable();
  const vendor = await getVendorProfileForUser(userId);
  const result = await prisma.$executeRawUnsafe(`DELETE FROM flash_deals WHERE id = $1 AND vendor_id = $2`, id, vendor.id);
  if (!result) throw AppError.notFound("Flash deal not found");
  return { ok: true };
}

export async function getActivePrices(productIds: string[]) {
  await ensureTable();
  if (!productIds.length) return new Map<string, number>();
  const rows = await prisma.$queryRawUnsafe<Array<{ productId: string; salePrice: number }>>(`SELECT product_id AS "productId", sale_price AS "salePrice" FROM flash_deals WHERE product_id = ANY($1::text[]) AND active = true AND starts_at <= NOW() AND ends_at > NOW()`, productIds);
  return new Map(rows.map((row) => [row.productId, Number(row.salePrice)]));
}
