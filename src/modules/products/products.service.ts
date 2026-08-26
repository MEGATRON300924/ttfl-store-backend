import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { slugify } from "@/utils/slugify";
import { recordAudit } from "@/lib/audit";
import { assertProductLimitNotExceeded } from "@/modules/vendor-plans/vendor-plans.service";
import type { CreateProductInput, ProductSearchInput } from "./products.validators";
import type { Prisma } from "@prisma/client";

const PUBLIC_PRODUCT_INCLUDE = {
  images: { orderBy: { position: "asc" as const } },
  category: true,
  vendor: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      verified: true,
      location: true,
    },
  },
} satisfies Prisma.ProductInclude;

async function getVendorProfileOrThrow(userId: string) {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  if (vendor.status !== "APPROVED") {
    throw AppError.forbidden(
      "Your vendor application needs to be approved before you can list products",
      "VENDOR_NOT_APPROVED"
    );
  }
  return vendor;
}

async function uniqueProductSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  let suffix = 1;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${base}-${++suffix}`;
  }
  return slug;
}

async function resolveCategoryId(categorySlug: string) {
  const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category) throw AppError.badRequest("Unknown category", "INVALID_CATEGORY");
  return category.id;
}

export async function createProduct(userId: string, input: CreateProductInput) {
  const vendor = await getVendorProfileOrThrow(userId);
  await assertProductLimitNotExceeded(vendor.id, vendor.tier);
  const categoryId = await resolveCategoryId(input.categorySlug);
  const slug = await uniqueProductSlug(input.name);

  const product = await prisma.product.create({
    data: {
      vendorId: vendor.id,
      categoryId,
      name: input.name,
      slug,
      description: input.description,
      price: input.price,
      previousPrice: input.previousPrice,
      condition: input.condition,
      stock: input.stock,
      location: input.location,
      specifications: input.specifications,
      sellingMethod: input.sellingMethod,
      externalUrl: "externalUrl" in input ? input.externalUrl : undefined,
      whatsappNumber: "whatsappNumber" in input ? input.whatsappNumber : undefined,
      images: {
        create: input.images.map((url, i) => ({ url, position: i, isPrimary: i === 0 })),
      },
    },
    include: PUBLIC_PRODUCT_INCLUDE,
  });

  return product;
}

export async function updateProduct(
  userId: string,
  productId: string,
  input: Partial<CreateProductInput> & { status?: "DRAFT" | "ACTIVE" | "OUT_OF_STOCK" }
) {
  const vendor = await getVendorProfileOrThrow(userId);
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing || existing.deletedAt) throw AppError.notFound("Product not found");
  if (existing.vendorId !== vendor.id) {
    throw AppError.forbidden("You can only edit your own products");
  }

  const categoryId = input.categorySlug ? await resolveCategoryId(input.categorySlug) : undefined;

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      name: input.name,
      categoryId,
      description: input.description,
      price: input.price,
      previousPrice: input.previousPrice,
      condition: input.condition,
      stock: input.stock,
      location: input.location,
      specifications: input.specifications,
      status: input.status,
      sellingMethod: (input as any).sellingMethod,
      externalUrl: (input as any).externalUrl,
      whatsappNumber: (input as any).whatsappNumber,
      ...(input.images
        ? {
            images: {
              deleteMany: {},
              create: input.images.map((url, i) => ({ url, position: i, isPrimary: i === 0 })),
            },
          }
        : {}),
    },
    include: PUBLIC_PRODUCT_INCLUDE,
  });

  return product;
}

export async function deleteProduct(userId: string, productId: string) {
  const vendor = await getVendorProfileOrThrow(userId);
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing || existing.deletedAt) throw AppError.notFound("Product not found");
  if (existing.vendorId !== vendor.id) {
    throw AppError.forbidden("You can only delete your own products");
  }

  await prisma.product.update({ where: { id: productId }, data: { deletedAt: new Date() } });
}

export async function listMyProducts(userId: string) {
  const vendor = await getVendorProfileOrThrow(userId);
  return prisma.product.findMany({
    where: { vendorId: vendor.id, deletedAt: null },
    include: PUBLIC_PRODUCT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: PUBLIC_PRODUCT_INCLUDE,
  });
  if (!product || product.deletedAt || product.status === "SUSPENDED") {
    throw AppError.notFound("Product not found");
  }

  // Fire-and-forget view counter — not worth blocking the response on.
  void prisma.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } });

  return product;
}

function buildOrderBy(sort: ProductSearchInput["sort"]): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case "price_asc":
      return { price: "asc" };
    case "price_desc":
      return { price: "desc" };
    case "newest":
      return { createdAt: "desc" };
    case "rating":
      // No review aggregate table yet — falls back to popularity by views.
      return { viewCount: "desc" };
    default:
      return { viewCount: "desc" };
  }
}

export async function searchProducts(params: ProductSearchInput) {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: "ACTIVE",
  };

  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: "insensitive" } },
      { description: { contains: params.q, mode: "insensitive" } },
    ];
  }
  if (params.category) where.category = { slug: params.category };
  if (params.condition) where.condition = params.condition;
  if (params.sellingMethod) where.sellingMethod = params.sellingMethod;
  if (params.location) where.location = { contains: params.location, mode: "insensitive" };

  // Built as a separate, plainly-typed object and applied via the `is:`
  // wrapper — Prisma generates required to-one relation filters (like
  // Product.vendor here) as an XOR<VendorProfileRelationFilter,
  // VendorProfileWhereInput>. Spreading `where.vendor` back into itself
  // (the old `{ ...where.vendor, verified: true }` pattern) doesn't
  // type-check against that XOR union — TS reports the extra key as not
  // assignable to the sibling branch's `never`-typed properties. Building
  // the filter separately and assigning once via `is:` sidesteps the XOR
  // entirely and is the pattern Prisma's own docs use for this exact case.
  if (params.vendor || params.verifiedOnly) {
    const vendorFilter: Prisma.VendorProfileWhereInput = {};
    if (params.vendor) vendorFilter.storeSlug = params.vendor;
    if (params.verifiedOnly) vendorFilter.verified = true;
    where.vendor = { is: vendorFilter };
  }

  if (params.minPrice || params.maxPrice) {
    where.price = {
      ...(params.minPrice ? { gte: params.minPrice } : {}),
      ...(params.maxPrice ? { lte: params.maxPrice } : {}),
    };
  }

  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: PUBLIC_PRODUCT_INCLUDE,
      orderBy: buildOrderBy(params.sort),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

// ---------------------------------------------------------------------------
// Selling method §14 — record-before-redirect for EXTERNAL_LINK / WHATSAPP
// ---------------------------------------------------------------------------

export async function recordReferralAndGetDestination(
  productId: string,
  meta: { sessionId?: string; source?: string; userAgent?: string; ipAddress?: string; deviceType?: string; campaign?: string }
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { vendor: true },
  });
  if (!product || product.deletedAt) throw AppError.notFound("Product not found");

  let destination: string;
  let type: "EXTERNAL_CLICK" | "WHATSAPP_CLICK";

  if (product.sellingMethod === "EXTERNAL_LINK") {
    if (!product.externalUrl) throw AppError.internal("Product is missing its external URL");
    destination = product.externalUrl;
    type = "EXTERNAL_CLICK";
  } else if (product.sellingMethod === "WHATSAPP") {
    const number = product.whatsappNumber ?? product.vendor.whatsappNumber;
    if (!number) throw AppError.internal("Product is missing a WhatsApp number");
    const message = encodeURIComponent(
      `Hi, I'm interested in "${product.name}" (${env.appUrl}/products/${product.slug})`
    );
    destination = `https://wa.me/${number.replace(/\D/g, "")}?text=${message}`;
    type = "WHATSAPP_CLICK";
  } else {
    throw AppError.badRequest("This product uses TTFL Store checkout, not an external referral");
  }

  // Written BEFORE the caller redirects — satisfies spec §14/§15.
  await prisma.referralEvent.create({
    data: {
      vendorId: product.vendorId,
      productId: product.id,
      type,
      sessionId: meta.sessionId,
      source: meta.source,
      destination,
      userAgent: meta.userAgent,
      deviceType: meta.deviceType,
      campaign: meta.campaign,
      ipAddress: meta.ipAddress,
    },
  });

  return { destination };
}

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

// Unlike searchProducts (public, ACTIVE-only), this surfaces every status
// so admins can find and moderate suspended/draft/out-of-stock listings too.
export async function adminListProducts(params: { q?: string; page: number; limit: number }) {
  const where: Prisma.ProductWhereInput = { deletedAt: null };
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: "insensitive" } },
      { vendor: { storeName: { contains: params.q, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: PUBLIC_PRODUCT_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

export async function suspendProduct(productId: string, adminId: string, ipAddress?: string) {
  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: "SUSPENDED" },
  });
  await recordAudit({
    actorId: adminId,
    action: "PRODUCT_SUSPENDED",
    targetType: "Product",
    targetId: product.id,
    ipAddress,
  });
  return product;
}

export async function reinstateProduct(productId: string, adminId: string, ipAddress?: string) {
  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: "ACTIVE" },
  });
  await recordAudit({
    actorId: adminId,
    action: "PRODUCT_REINSTATED",
    targetType: "Product",
    targetId: product.id,
    ipAddress,
  });
  return product;
}
