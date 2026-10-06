import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const carsStoreRouter = Router();

async function ensureCarsStoreTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cars_store_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      source_vendor_id TEXT NULL REFERENCES vendor_profiles(id) ON DELETE SET NULL,
      store_name TEXT NOT NULL,
      store_slug TEXT NOT NULL UNIQUE,
      location TEXT NULL,
      whatsapp_number TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cars_store_profiles_source_vendor_idx ON cars_store_profiles(source_vendor_id)`);
}

const storeSchema = z.object({
  storeName: z.string().trim().min(2).max(100),
  storeSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  location: z.string().trim().max(200).optional().nullable(),
  whatsappNumber: z.string().trim().max(30).optional().nullable(),
  useExistingStore: z.boolean().default(false),
});

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/\\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function uniqueSlug(base: string) {
  const normalized = slugify(base) || "cars-store";
  let slug = normalized;
  let suffix = 1;
  while (true) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM cars_store_profiles WHERE store_slug = $1 LIMIT 1`, slug
    );
    if (!rows[0]) return slug;
    slug = `${normalized}-${++suffix}`;
  }
}

carsStoreRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  await ensureCarsStoreTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, user_id AS "userId", source_vendor_id AS "sourceVendorId", store_name AS "storeName", store_slug AS "storeSlug", location, whatsapp_number AS "whatsappNumber", created_at AS "createdAt", updated_at AS "updatedAt" FROM cars_store_profiles WHERE user_id = $1 LIMIT 1`,
    req.user!.sub
  );
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId: req.user!.sub },
    select: { id: true, storeName: true, storeSlug: true, location: true, whatsappNumber: true, status: true, verified: true }
  });
  res.json({ carsStore: rows[0] ?? null, existingStore: vendor ?? null });
}));

carsStoreRouter.post("/me", requireAuth, asyncHandler(async (req, res) => {
  await ensureCarsStoreTable();
  const input = storeSchema.parse(req.body);
  const existing = await prisma.vendorProfile.findUnique({ where: { userId: req.user!.sub } });
  const already = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM cars_store_profiles WHERE user_id = $1 LIMIT 1`, req.user!.sub
  );
  if (already[0]) throw AppError.conflict("Your TTFL Cars store already exists", "CARS_STORE_EXISTS");

  let sourceVendorId: string | null = existing?.id ?? null;
  let storeName = input.storeName;
  let location = input.location ?? null;
  let whatsappNumber = input.whatsappNumber ?? null;

  if (input.useExistingStore) {
    if (!existing) throw AppError.badRequest("No existing TTFL Store was found on this account", "NO_EXISTING_STORE");
    sourceVendorId = existing.id;
    storeName = existing.storeName;
    location = existing.location ?? null;
    whatsappNumber = existing.whatsappNumber ?? null;
  }

  const slug = await uniqueSlug(input.storeSlug || storeName);
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO cars_store_profiles (id, user_id, source_vendor_id, store_name, store_slug, location, whatsapp_number) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    id, req.user!.sub, sourceVendorId, storeName, slug, location, whatsappNumber
  );

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, user_id AS "userId", source_vendor_id AS "sourceVendorId", store_name AS "storeName", store_slug AS "storeSlug", location, whatsapp_number AS "whatsappNumber", created_at AS "createdAt", updated_at AS "updatedAt" FROM cars_store_profiles WHERE id = $1`, id
  );
  res.status(201).json({ carsStore: rows[0] });
}));
