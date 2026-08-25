import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { slugify } from "@/utils/slugify";
import { recordAudit } from "@/lib/audit";

export async function listCategories() {
  // Only top-level categories with their children — matches how the
  // homepage/nav wants to render a shallow tree (spec §11 filters).
  return prisma.category.findMany({
    where: { parentId: null },
    include: { children: true },
    orderBy: { name: "asc" },
  });
}

export async function getCategoryBySlug(slug: string) {
  const category = await prisma.category.findUnique({
    where: { slug },
    include: { children: true },
  });
  if (!category) throw AppError.notFound("Category not found");
  return category;
}

export async function createCategory(
  input: { name: string; icon?: string; parentSlug?: string },
  adminId: string
) {
  let parentId: string | undefined;
  if (input.parentSlug) {
    const parent = await prisma.category.findUnique({ where: { slug: input.parentSlug } });
    if (!parent) throw AppError.badRequest("Parent category not found");
    parentId = parent.id;
  }

  const baseSlug = slugify(input.name);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.category.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++suffix}`;
  }

  const category = await prisma.category.create({
    data: { name: input.name, slug, icon: input.icon, parentId },
  });

  await recordAudit({
    actorId: adminId,
    action: "CATEGORY_CREATED",
    targetType: "Category",
    targetId: category.id,
  });

  return category;
}

export async function updateCategory(
  id: string,
  input: { name?: string; icon?: string },
  adminId: string
) {
  const category = await prisma.category.update({
    where: { id },
    data: input,
  });

  await recordAudit({
    actorId: adminId,
    action: "CATEGORY_UPDATED",
    targetType: "Category",
    targetId: category.id,
    metadata: input,
  });

  return category;
}
