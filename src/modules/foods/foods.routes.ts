import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import * as productsService from "@/modules/products/products.service";
import { createProductSchema, updateProductSchema } from "@/modules/products/products.validators";

export const foodsRouter = Router();

async function ensureFoodsTables() {
  await prisma.category.upsert({
    where: { slug: "foods" },
    update: { name: "Foods" },
    create: { name: "Foods", slug: "foods", icon: "utensils" },
  });
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS foods_restaurant_profiles (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,
      description TEXT NULL,
      restaurant_name TEXT NULL,
      restaurant_slug TEXT NULL,
      restaurant_address TEXT NULL,
      restaurant_latitude DOUBLE PRECISION NULL,
      restaurant_longitude DOUBLE PRECISION NULL,
      cuisine_tags TEXT[] NOT NULL DEFAULT '{}',
      phone_number TEXT NULL,
      prep_time_min INTEGER NOT NULL DEFAULT 20,
      prep_time_max INTEGER NOT NULL DEFAULT 45,
      min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      accepts_orders BOOLEAN NOT NULL DEFAULT TRUE,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      restaurant_riders BOOLEAN NOT NULL DEFAULT TRUE,
      ttfl_delivery BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT foods_prep_time_check CHECK (prep_time_min > 0 AND prep_time_max >= prep_time_min),
      CONSTRAINT foods_min_order_check CHECK (min_order_amount >= 0),
      CONSTRAINT foods_delivery_mode_check CHECK (restaurant_riders OR ttfl_delivery)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS foods_delivery_areas (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      city TEXT NOT NULL,
      area TEXT NOT NULL,
      delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      minimum_order NUMERIC(12,2) NOT NULL DEFAULT 0,
      estimated_minutes INTEGER NOT NULL DEFAULT 45,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT foods_area_fee_check CHECK (delivery_fee >= 0 AND minimum_order >= 0),
      CONSTRAINT foods_area_eta_check CHECK (estimated_minutes > 0)
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE foods_restaurant_profiles ADD COLUMN IF NOT EXISTS restaurant_name TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE foods_restaurant_profiles ADD COLUMN IF NOT EXISTS restaurant_slug TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE foods_restaurant_profiles ADD COLUMN IF NOT EXISTS restaurant_address TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE foods_restaurant_profiles ADD COLUMN IF NOT EXISTS restaurant_latitude DOUBLE PRECISION`);
  await prisma.$executeRawUnsafe(`ALTER TABLE foods_restaurant_profiles ADD COLUMN IF NOT EXISTS restaurant_longitude DOUBLE PRECISION`);
  await prisma.$executeRawUnsafe(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude DOUBLE PRECISION`);
  await prisma.$executeRawUnsafe(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS foods_restaurant_profiles_slug_idx ON foods_restaurant_profiles(restaurant_slug) WHERE restaurant_slug IS NOT NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS foods_delivery_areas_vendor_idx ON foods_delivery_areas(vendor_id, enabled)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS foods_delivery_areas_location_idx ON foods_delivery_areas(state, city, area) WHERE enabled = TRUE`);
}

function restaurantSlugify(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "restaurant";
}

async function uniqueRestaurantSlug(value: string, vendorId: string) {
  const base = restaurantSlugify(value);
  let slug = base;
  let suffix = 1;
  while (true) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM foods_restaurant_profiles WHERE restaurant_slug=$1 AND vendor_id<>$2 LIMIT 1`, slug, vendorId,
    );
    if (!rows[0]) return slug;
    slug = `${base}-${++suffix}`;
  }
}

async function getOwnRestaurant(userId: string) {
  await ensureFoodsTables();
  const vendor = await getVendorProfileForUser(userId);
  await prisma.$executeRawUnsafe(
    `INSERT INTO foods_restaurant_profiles (id, vendor_id) VALUES ($1,$2) ON CONFLICT (vendor_id) DO NOTHING`,
    randomUUID(), vendor.id,
  );
  const defaultSlug = await uniqueRestaurantSlug(vendor.storeName, vendor.id);
  await prisma.$executeRawUnsafe(
    `UPDATE foods_restaurant_profiles SET restaurant_name=COALESCE(restaurant_name,$2), restaurant_slug=COALESCE(restaurant_slug,$3), restaurant_address=COALESCE(restaurant_address,$4), phone_number=COALESCE(phone_number,$5) WHERE vendor_id=$1`,
    vendor.id, vendor.storeName, defaultSlug, vendor.location ?? null, vendor.whatsappNumber ?? null,
  );
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, vendor_id AS "vendorId", restaurant_name AS "restaurantName", restaurant_slug AS "restaurantSlug", restaurant_address AS "restaurantAddress", restaurant_latitude AS "restaurantLatitude", restaurant_longitude AS "restaurantLongitude", description, cuisine_tags AS "cuisineTags",
      phone_number AS "phoneNumber", prep_time_min AS "prepTimeMin", prep_time_max AS "prepTimeMax",
      min_order_amount AS "minOrderAmount", accepts_orders AS "acceptsOrders", is_published AS "isPublished",
      restaurant_riders AS "restaurantRiders", ttfl_delivery AS "ttflDelivery"
     FROM foods_restaurant_profiles WHERE vendor_id=$1 LIMIT 1`,
    vendor.id,
  );
  return { vendor, restaurant: rows[0] };
}
const profileSchema = z.object({
  restaurantName: z.string().trim().min(2).max(100).optional(),
  restaurantAddress: z.string().trim().min(5).max(300).optional(),
  restaurantLatitude: z.number().min(-90).max(90).nullable().optional(),
  restaurantLongitude: z.number().min(-180).max(180).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  cuisineTags: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  phoneNumber: z.string().trim().max(30).nullable().optional(),
  prepTimeMin: z.number().int().min(5).max(240).optional(),
  prepTimeMax: z.number().int().min(5).max(360).optional(),
  minOrderAmount: z.number().min(0).max(100000000).optional(),
  acceptsOrders: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  restaurantRiders: z.boolean().optional(),
  ttflDelivery: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.prepTimeMin !== undefined && data.prepTimeMax !== undefined && data.prepTimeMax < data.prepTimeMin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Maximum preparation time must be at least the minimum.", path: ["prepTimeMax"] });
  }
  if (data.restaurantRiders === false && data.ttflDelivery === false) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enable restaurant delivery or TTFL delivery.", path: ["ttflDelivery"] });
  }
  if ((data.restaurantLatitude === null) !== (data.restaurantLongitude === null) ||
      (data.restaurantLatitude === undefined) !== (data.restaurantLongitude === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Restaurant latitude and longitude must be supplied together.", path: ["restaurantLatitude"] });
  }
});

const areaSchema = z.object({
  state: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  area: z.string().trim().min(2).max(120),
  deliveryFee: z.number().min(0).max(10000000).default(0),
  minimumOrder: z.number().min(0).max(10000000).default(0),
  estimatedMinutes: z.number().int().min(5).max(360).default(45),
  enabled: z.boolean().default(true),
});

foodsRouter.get("/restaurants", asyncHandler(async (req, res) => {
  await ensureFoodsTables();
  const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const area = typeof req.query.area === "string" ? req.query.area.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT vp.id AS "vendorId", COALESCE(frp.restaurant_name,vp."storeName") AS "storeName", COALESCE(frp.restaurant_slug,vp."storeSlug") AS "storeSlug",
      vp."logoUrl" AS "logoUrl", vp."bannerUrl" AS "bannerUrl", COALESCE(frp.restaurant_address,vp.location) AS location, frp.restaurant_latitude AS "latitude", frp.restaurant_longitude AS "longitude", vp.verified,
      frp.description, frp.cuisine_tags AS "cuisineTags", frp.prep_time_min AS "prepTimeMin",
      frp.prep_time_max AS "prepTimeMax", frp.min_order_amount AS "minOrderAmount",
      frp.restaurant_riders AS "restaurantRiders", frp.ttfl_delivery AS "ttflDelivery"
     FROM foods_restaurant_profiles frp
     JOIN vendor_profiles vp ON vp.id=frp.vendor_id
     WHERE vp.status='APPROVED' AND frp.is_published=TRUE AND frp.accepts_orders=TRUE
       AND ($1='' OR COALESCE(frp.restaurant_name,vp."storeName") ILIKE '%'||$1||'%' OR frp.description ILIKE '%'||$1||'%' OR EXISTS (SELECT 1 FROM unnest(frp.cuisine_tags) tag WHERE tag ILIKE '%'||$1||'%'))
       AND ($2='' OR EXISTS (SELECT 1 FROM foods_delivery_areas a WHERE a.vendor_id=vp.id AND a.enabled=TRUE AND lower(a.state)=lower($2)))
       AND ($3='' OR EXISTS (SELECT 1 FROM foods_delivery_areas a WHERE a.vendor_id=vp.id AND a.enabled=TRUE AND lower(a.city)=lower($3)))
       AND ($4='' OR EXISTS (SELECT 1 FROM foods_delivery_areas a WHERE a.vendor_id=vp.id AND a.enabled=TRUE AND lower(a.area)=lower($4)))
     ORDER BY COALESCE(frp.restaurant_name,vp."storeName") ASC LIMIT 100`,
    q, state, city, area,
  );
  res.json({ restaurants: rows });
}));

foodsRouter.get("/restaurants/:slug", asyncHandler(async (req, res) => {
  await ensureFoodsTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT vp.id AS "vendorId", COALESCE(frp.restaurant_name,vp."storeName") AS "storeName", COALESCE(frp.restaurant_slug,vp."storeSlug") AS "storeSlug",
      vp."logoUrl" AS "logoUrl", vp."bannerUrl" AS "bannerUrl", COALESCE(frp.restaurant_address,vp.location) AS location, vp.verified,
      frp.description, frp.cuisine_tags AS "cuisineTags", frp.phone_number AS "phoneNumber",
      frp.prep_time_min AS "prepTimeMin", frp.prep_time_max AS "prepTimeMax",
      frp.min_order_amount AS "minOrderAmount", frp.accepts_orders AS "acceptsOrders",
      frp.restaurant_riders AS "restaurantRiders", frp.ttfl_delivery AS "ttflDelivery"
     FROM foods_restaurant_profiles frp JOIN vendor_profiles vp ON vp.id=frp.vendor_id
     WHERE COALESCE(frp.restaurant_slug,vp."storeSlug")=$1 AND vp.status='APPROVED' AND frp.is_published=TRUE LIMIT 1`,
    req.params.slug,
  );
  if (!rows[0]) throw AppError.notFound("Restaurant not found.", "RESTAURANT_NOT_FOUND");
  const areas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT state,city,area,delivery_fee AS "deliveryFee",minimum_order AS "minimumOrder",
      estimated_minutes AS "estimatedMinutes" FROM foods_delivery_areas
     WHERE vendor_id=$1 AND enabled=TRUE ORDER BY state,city,area`,
    rows[0].vendorId,
  );
  res.json({ restaurant: rows[0], deliveryAreas: areas });
}));

foodsRouter.get("/restaurants/:slug/menu", asyncHandler(async (req, res) => {
  await ensureFoodsTables();
  const vendorRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT vp.id, frp.is_published AS "isPublished" FROM vendor_profiles vp JOIN foods_restaurant_profiles frp ON frp.vendor_id=vp.id
     WHERE COALESCE(frp.restaurant_slug,vp."storeSlug")=$1 AND vp.status='APPROVED' LIMIT 1`,
    req.params.slug,
  );
  const vendor = vendorRows[0];
  if (!vendor?.isPublished) throw AppError.notFound("Restaurant not found.", "RESTAURANT_NOT_FOUND");
  const items = await prisma.product.findMany({
    where: { vendorId: vendor.id, deletedAt: null, status: "ACTIVE", comingSoon: false, category: { slug: "foods" } },
    include: { images: { orderBy: { position: "asc" } }, category: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items });
}));

foodsRouter.get("/me/profile", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor, restaurant } = await getOwnRestaurant(req.user!.sub);
  res.json({ vendor: { id: vendor.id, storeName: vendor.storeName, storeSlug: vendor.storeSlug, status: vendor.status, verified: vendor.verified }, restaurant });
}));

foodsRouter.put("/me/profile", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor, restaurant } = await getOwnRestaurant(req.user!.sub);
  const data = profileSchema.parse(req.body);
  if (data.isPublished === true && vendor.status !== "APPROVED") {
    throw AppError.forbidden("Your main TTFL Store vendor profile must be approved before your restaurant can be published.", "VENDOR_NOT_APPROVED");
  }
  const nextOwnRiders = data.restaurantRiders ?? restaurant.restaurantRiders;
  const nextTtflDelivery = data.ttflDelivery ?? restaurant.ttflDelivery;
  if (!nextOwnRiders && !nextTtflDelivery) throw AppError.badRequest("Enable restaurant delivery or TTFL delivery.", "DELIVERY_METHOD_REQUIRED");
  const nextRestaurantSlug = data.restaurantName && data.restaurantName !== restaurant.restaurantName
    ? await uniqueRestaurantSlug(data.restaurantName, vendor.id)
    : null;
  await prisma.$executeRawUnsafe(
    `UPDATE foods_restaurant_profiles SET
      description=COALESCE($2,description), cuisine_tags=COALESCE($3::text[],cuisine_tags),
      phone_number=COALESCE($4,phone_number), prep_time_min=COALESCE($5,prep_time_min),
      prep_time_max=COALESCE($6,prep_time_max), min_order_amount=COALESCE($7,min_order_amount),
      accepts_orders=COALESCE($8,accepts_orders), is_published=COALESCE($9,is_published),
      restaurant_riders=$10, ttfl_delivery=$11, restaurant_name=COALESCE($12,restaurant_name),
      restaurant_slug=COALESCE($13,restaurant_slug), restaurant_address=COALESCE($14,restaurant_address),
      restaurant_latitude=CASE WHEN $15::boolean THEN $16::double precision ELSE restaurant_latitude END,
      restaurant_longitude=CASE WHEN $17::boolean THEN $18::double precision ELSE restaurant_longitude END, updated_at=NOW()
     WHERE vendor_id=$1`,
    vendor.id, data.description ?? null, data.cuisineTags ?? null, data.phoneNumber ?? null,
    data.prepTimeMin ?? null, data.prepTimeMax ?? null, data.minOrderAmount ?? null,
    data.acceptsOrders ?? null, data.isPublished ?? null, nextOwnRiders, nextTtflDelivery,
    data.restaurantName ?? null, nextRestaurantSlug, data.restaurantAddress ?? null,
    data.restaurantLatitude !== undefined, data.restaurantLatitude ?? null,
    data.restaurantLongitude !== undefined, data.restaurantLongitude ?? null,
  );
  const updated = await getOwnRestaurant(req.user!.sub);
  res.json({ restaurant: updated.restaurant, message: "Restaurant profile saved." });
}));
foodsRouter.get("/me/areas", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const areas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id,state,city,area,delivery_fee AS "deliveryFee",minimum_order AS "minimumOrder",
      estimated_minutes AS "estimatedMinutes",enabled FROM foods_delivery_areas
     WHERE vendor_id=$1 ORDER BY state,city,area`,
    vendor.id,
  );
  res.json({ areas });
}));

foodsRouter.post("/me/areas", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const data = areaSchema.parse(req.body);
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO foods_delivery_areas (id,vendor_id,state,city,area,delivery_fee,minimum_order,estimated_minutes,enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    id, vendor.id, data.state, data.city, data.area, data.deliveryFee, data.minimumOrder, data.estimatedMinutes, data.enabled,
  );
  res.status(201).json({ area: { id, ...data } });
}));

foodsRouter.patch("/me/areas/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const data = areaSchema.partial().parse(req.body);
  const current = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id,state,city,area,delivery_fee AS "deliveryFee",minimum_order AS "minimumOrder",
      estimated_minutes AS "estimatedMinutes",enabled FROM foods_delivery_areas WHERE id=$1 AND vendor_id=$2 LIMIT 1`,
    req.params.id, vendor.id,
  );
  if (!current[0]) throw AppError.notFound("Delivery area not found.", "DELIVERY_AREA_NOT_FOUND");
  const next = { ...current[0], ...data };
  await prisma.$executeRawUnsafe(
    `UPDATE foods_delivery_areas SET state=$3,city=$4,area=$5,delivery_fee=$6,minimum_order=$7,
      estimated_minutes=$8,enabled=$9,updated_at=NOW() WHERE id=$1 AND vendor_id=$2`,
    req.params.id, vendor.id, next.state, next.city, next.area, next.deliveryFee,
    next.minimumOrder, next.estimatedMinutes, next.enabled,
  );
  res.json({ area: { id: req.params.id, ...next } });
}));

foodsRouter.delete("/me/areas/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM foods_delivery_areas WHERE id=$1 AND vendor_id=$2`,
    req.params.id, vendor.id,
  );
  if (!result) throw AppError.notFound("Delivery area not found.", "DELIVERY_AREA_NOT_FOUND");
  res.status(204).send();
}));

foodsRouter.get("/me/menu", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const items = await prisma.product.findMany({
    where: { vendorId: vendor.id, deletedAt: null, category: { slug: "foods" } },
    include: { images: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items });
}));

foodsRouter.post("/me/menu", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  await ensureFoodsTables();
  const product = await productsService.createProduct(req.user!.sub, createProductSchema.parse({ ...req.body, categorySlug: "foods" }));
  res.status(201).json({ item: product });
}));

foodsRouter.patch("/me/menu/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, vendorId: vendor.id, deletedAt: null, category: { slug: "foods" } },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound("Menu item not found.", "MENU_ITEM_NOT_FOUND");
  const item = await productsService.updateProduct(req.user!.sub, req.params.id, updateProductSchema.parse(req.body) as any);
  res.json({ item });
}));

foodsRouter.delete("/me/menu/:id", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => {
  const { vendor } = await getOwnRestaurant(req.user!.sub);
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, vendorId: vendor.id, deletedAt: null, category: { slug: "foods" } },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound("Menu item not found.", "MENU_ITEM_NOT_FOUND");
  await productsService.deleteProduct(req.user!.sub, req.params.id);
  res.status(204).send();
}));
