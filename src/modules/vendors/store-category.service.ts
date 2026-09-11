import { prisma } from "@/lib/prisma";

export async function ensureStoreCategoryTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS vendor_store_categories (vendor_id TEXT PRIMARY KEY REFERENCES vendor_profiles(id) ON DELETE CASCADE, category_slug TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS vendor_store_categories_slug_idx ON vendor_store_categories(category_slug)`);
}

export async function setStoreCategory(vendorId: string, categorySlug: string | null | undefined) {
  await ensureStoreCategoryTable();
  const value = categorySlug?.trim().toLowerCase() || null;
  if (!value) {
    await prisma.$executeRawUnsafe(`DELETE FROM vendor_store_categories WHERE vendor_id = $1`, vendorId);
    return null;
  }
  const category = await prisma.category.findUnique({ where: { slug: value }, select: { slug: true } });
  if (!category) throw new Error("Invalid store category");
  await prisma.$executeRawUnsafe(`INSERT INTO vendor_store_categories (vendor_id, category_slug) VALUES ($1, $2) ON CONFLICT (vendor_id) DO UPDATE SET category_slug = EXCLUDED.category_slug, updated_at = NOW()`, vendorId, category.slug);
  return category.slug;
}

export async function getStoreCategory(vendorId: string) {
  await ensureStoreCategoryTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ category_slug: string; category_name: string | null }>>(`SELECT vsc.category_slug, c.name AS category_name FROM vendor_store_categories vsc LEFT JOIN categories c ON c.slug = vsc.category_slug WHERE vsc.vendor_id = $1 LIMIT 1`, vendorId);
  return rows[0] ? { slug: rows[0].category_slug, name: rows[0].category_name ?? rows[0].category_slug } : null;
}
