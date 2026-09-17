import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { slugify } from "@/utils/slugify";
import { recordAudit } from "@/lib/audit";

export type CategoryVariationType = "PRODUCT" | "CLOTHING" | "OTHER";
export type CategoryVariationOption = { id: string; label: string; value: string };
export type CategoryVariation = { id: string; key: string; name: string; type: CategoryVariationType; options: CategoryVariationOption[] };
export type CategoryVariationConfig = { enabled: boolean; variations: CategoryVariation[] };

const EMPTY_CONFIG: CategoryVariationConfig = { enabled: false, variations: [] };
let columnReady: Promise<void> | null = null;

async function ensureVariationColumn() {
  if (!columnReady) columnReady = prisma.$executeRawUnsafe('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "variationConfig" JSONB').then(() => undefined);
  await columnReady;
}

function normalizeConfig(value: unknown): CategoryVariationConfig {
  if (!value || typeof value !== "object") return EMPTY_CONFIG;
  const raw = value as Record<string, unknown>;
  const variations = Array.isArray(raw.variations) ? raw.variations : [];
  return {
    enabled: raw.enabled === true && variations.length > 0,
    variations: variations.map((item) => {
      const v = item as Record<string, unknown>;
      const options = Array.isArray(v.options) ? v.options : [];
      return {
        id: String(v.id || crypto.randomUUID()),
        key: String(v.key || slugify(String(v.name || "option"))),
        name: String(v.name || "Option"),
        type: v.type === "CLOTHING" || v.type === "OTHER" ? v.type : "PRODUCT",
        options: options.map((option) => {
          const o = option as Record<string, unknown>;
          const valueText = String(o.value ?? o.label ?? "").trim();
          return { id: String(o.id || crypto.randomUUID()), label: String(o.label || valueText), value: valueText };
        }).filter((o) => o.value),
      };
    }).filter((v) => v.name.trim() && v.options.length),
  };
}

async function configsFor(ids: string[]) {
  await ensureVariationColumn();
  if (!ids.length) return new Map<string, CategoryVariationConfig>();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; variationConfig: unknown }>>(`SELECT "id", "variationConfig" FROM "categories" WHERE "id" = ANY($1::text[])`, ids);
  return new Map(rows.map((row) => [row.id, normalizeConfig(row.variationConfig)]));
}

function withConfig<T extends { id: string }>(category: T, configs: Map<string, CategoryVariationConfig>) {
  return { ...category, variationConfig: configs.get(category.id) ?? EMPTY_CONFIG };
}

export async function listCategories() {
  const categories = await prisma.category.findMany({ where: { parentId: null }, include: { children: true }, orderBy: { name: "asc" } });
  const ids = categories.flatMap((category) => [category.id, ...category.children.map((child) => child.id)]);
  const configs = await configsFor(ids);
  return categories.map((category) => ({ ...withConfig(category, configs), children: category.children.map((child) => withConfig(child, configs)) }));
}

export async function getCategoryBySlug(slug: string) {
  const category = await prisma.category.findUnique({ where: { slug }, include: { children: true } });
  if (!category) throw AppError.notFound("Category not found");
  const configs = await configsFor([category.id, ...category.children.map((child) => child.id)]);
  return { ...withConfig(category, configs), children: category.children.map((child) => withConfig(child, configs)) };
}

export async function createCategory(input: { name: string; icon?: string; parentSlug?: string; variationConfig?: CategoryVariationConfig }, adminId: string) {
  await ensureVariationColumn();
  let parentId: string | undefined;
  if (input.parentSlug) {
    const parent = await prisma.category.findUnique({ where: { slug: input.parentSlug } });
    if (!parent) throw AppError.badRequest("Parent category not found");
    parentId = parent.id;
  }
  const baseSlug = slugify(input.name);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.category.findUnique({ where: { slug } })) slug = `${baseSlug}-${++suffix}`;
  const variationConfig = normalizeConfig(input.variationConfig);
  const category = await prisma.category.create({ data: { name: input.name, slug, icon: input.icon, parentId } });
  await prisma.$executeRawUnsafe('UPDATE "categories" SET "variationConfig" = $1::jsonb WHERE "id" = $2', JSON.stringify(variationConfig), category.id);
  await recordAudit({ actorId: adminId, action: "CATEGORY_CREATED", targetType: "Category", targetId: category.id, metadata: { variationConfig } });
  return { ...category, variationConfig };
}

export async function updateCategory(id: string, input: { name?: string; icon?: string; variationConfig?: CategoryVariationConfig }, adminId: string) {
  await ensureVariationColumn();
  const category = await prisma.category.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.icon !== undefined ? { icon: input.icon } : {}) } });
  let variationConfig: CategoryVariationConfig | undefined;
  if (input.variationConfig !== undefined) {
    variationConfig = normalizeConfig(input.variationConfig);
    await prisma.$executeRawUnsafe('UPDATE "categories" SET "variationConfig" = $1::jsonb WHERE "id" = $2', JSON.stringify(variationConfig), id);
  }
  const configs = await configsFor([id]);
  await recordAudit({ actorId: adminId, action: "CATEGORY_UPDATED", targetType: "Category", targetId: category.id, metadata: { ...input, variationConfig } });
  return withConfig(category, configs);
}

export async function deleteCategory(id: string, adminId: string) {
  const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
  if (!category) throw AppError.notFound("Category not found");
  if (category._count.products > 0) throw AppError.badRequest("This category has products. Move or remove those products before deleting it.");
  if (category._count.children > 0) throw AppError.badRequest("This category has subcategories. Delete or move its subcategories first.");
  await prisma.category.delete({ where: { id } });
  await recordAudit({ actorId: adminId, action: "CATEGORY_UPDATED", targetType: "Category", targetId: id, metadata: { deleted: true } });
}
