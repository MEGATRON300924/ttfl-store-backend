import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import * as productsService from "@/modules/products/products.service";
import { createProductSchema, updateProductSchema } from "@/modules/products/products.validators";

export const carsDashboardRouter = Router();

async function ensureCarsDashboardTables() {
  await prisma.category.upsert({ where: { slug: "cars" }, update: { name: "Cars" }, create: { name: "Cars", slug: "cars" } });
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS cars_store_profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, source_vendor_id TEXT NULL REFERENCES vendor_profiles(id) ON DELETE SET NULL, store_name TEXT NOT NULL, store_slug TEXT NOT NULL UNIQUE, location TEXT NULL, whatsapp_number TEXT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, deactivated_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cars_booking_settings (
      cars_store_id TEXT PRIMARY KEY REFERENCES cars_store_profiles(id) ON DELETE CASCADE,
      whatsapp_number TEXT NULL,
      phone_number TEXT NULL,
      booking_url TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cars_bookings (
      id TEXT PRIMARY KEY,
      cars_store_id TEXT NOT NULL REFERENCES cars_store_profiles(id) ON DELETE CASCADE,
      product_id TEXT NULL REFERENCES products(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      preferred_date DATE NOT NULL,
      preferred_time TEXT NOT NULL,
      inspection_location TEXT NULL,
      message TEXT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      seller_note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE cars_store_profiles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`);
  await prisma.$executeRawUnsafe(`ALTER TABLE cars_store_profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cars_bookings_store_idx ON cars_bookings(cars_store_id, created_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cars_bookings_product_idx ON cars_bookings(product_id)`);
}

async function getCarsStore(userId: string) {
  await ensureCarsDashboardTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, user_id AS "userId", source_vendor_id AS "sourceVendorId", store_name AS "storeName", store_slug AS "storeSlug",
      location, whatsapp_number AS "whatsappNumber", active, deactivated_at AS "deactivatedAt", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM cars_store_profiles WHERE user_id = $1 LIMIT 1`, userId
  );
  if (!rows[0]) throw AppError.notFound("Your TTFL Cars store was not found", "CARS_STORE_NOT_FOUND");
  return rows[0];
}

const bookingSettingsSchema = z.object({
  storeName: z.string().trim().min(2).max(100).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  whatsappNumber: z.string().trim().max(30).nullable().optional(),
  phoneNumber: z.string().trim().max(30).nullable().optional(),
  bookingUrl: z.string().trim().url().max(500).nullable().optional(),
});

const bookingStatusSchema = z.enum(["PENDING","CONFIRMED","RESCHEDULED","DECLINED","COMPLETED","CANCELLED"]);

carsDashboardRouter.get("/public/listings", asyncHandler(async(req,res)=>{
  await ensureCarsDashboardTables();
  const rows=await prisma.$queryRawUnsafe<Array<{vendorId:string}>>(
    `SELECT source_vendor_id AS "vendorId" FROM cars_store_profiles WHERE active=TRUE AND source_vendor_id IS NOT NULL`
  );
  const vendorIds=rows.map(r=>r.vendorId).filter(Boolean);
  if(!vendorIds.length) return res.json({items:[]});
  const products=await prisma.product.findMany({
    where:{vendorId:{in:vendorIds},deletedAt:null,status:"ACTIVE",category:{slug:"cars"}},
    include:{images:{orderBy:{position:"asc"}},category:true,vendor:{select:{id:true,storeName:true,storeSlug:true,verified:true,location:true,whatsappNumber:true}}},
    orderBy:{createdAt:"desc"},take:100
  });
  res.json({items:products});
}));

carsDashboardRouter.get("/public/store/:slug", asyncHandler(async(req,res)=>{
  await ensureCarsDashboardTables();
  const stores=await prisma.$queryRawUnsafe<any[]>(`SELECT id,user_id AS "userId",store_name AS "storeName",store_slug AS "storeSlug",location,whatsapp_number AS "whatsappNumber",active FROM cars_store_profiles WHERE store_slug=$1 AND active=TRUE LIMIT 1`,req.params.slug);
  if(!stores[0]) throw AppError.notFound("Cars store not found","CARS_STORE_NOT_FOUND");
  const products=await prisma.product.findMany({
    where:{vendorId:stores[0].sourceVendorId ?? "",deletedAt:null,status:"ACTIVE",category:{slug:"cars"}},
    include:{images:{orderBy:{position:"asc"}},category:true,vendor:{select:{storeName:true,storeSlug:true,verified:true,location:true}}},
    orderBy:{createdAt:"desc"},take:100
  });
  res.json({store:stores[0],products});
}));

carsDashboardRouter.get("/public/listings/:slug", asyncHandler(async(req,res)=>{
  await ensureCarsDashboardTables();
  const product=await prisma.product.findFirst({
    where:{slug:req.params.slug,deletedAt:null,status:"ACTIVE",category:{slug:"cars"},vendorId:{in:(await prisma.$queryRawUnsafe<Array<{vendorId:string}>>(`SELECT source_vendor_id AS "vendorId" FROM cars_store_profiles WHERE active=TRUE AND source_vendor_id IS NOT NULL`)).map(x=>x.vendorId)}},
    include:{images:{orderBy:{position:"asc"}},category:true,vendor:{select:{id:true,storeName:true,storeSlug:true,verified:true,location:true,whatsappNumber:true}}}
  });
  if(!product) throw AppError.notFound("Vehicle listing not found","LISTING_NOT_FOUND");
  res.json(product);
}));

carsDashboardRouter.get("/public/by-product/:slug", asyncHandler(async(req,res)=>{
  await ensureCarsDashboardTables();
  const product=await prisma.product.findUnique({where:{slug:req.params.slug},select:{vendorId:true,category:{select:{slug:true}},deletedAt:true}});
  if(!product || product.deletedAt || product.category?.slug !== "cars") throw AppError.notFound("Vehicle listing not found","LISTING_NOT_FOUND");
  const stores=await prisma.$queryRawUnsafe<any[]>(`SELECT csp.id,csp.store_name AS "storeName",csp.active,
    cbs.whatsapp_number AS "whatsappNumber",cbs.phone_number AS "phoneNumber",cbs.booking_url AS "bookingUrl"
    FROM cars_store_profiles csp LEFT JOIN cars_booking_settings cbs ON cbs.cars_store_id=csp.id
    WHERE csp.source_vendor_id=$1 AND csp.active=TRUE LIMIT 1`,product.vendorId);
  if(!stores[0]) return res.json({store:null});
  res.json({store:stores[0]});
}));

carsDashboardRouter.get("/dashboard", requireAuth, asyncHandler(async (req, res) => {
  const store = await getCarsStore(req.user!.sub);
  const settings = await prisma.$queryRawUnsafe<any[]>(
    `SELECT whatsapp_number AS "whatsappNumber", phone_number AS "phoneNumber", booking_url AS "bookingUrl"
     FROM cars_booking_settings WHERE cars_store_id = $1 LIMIT 1`, store.id
  );
  const products = store.sourceVendorId
    ? await prisma.product.findMany({
        where: { vendorId: store.sourceVendorId, deletedAt: null, category: { slug: "cars" } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id:true, name:true, slug:true, price:true, currency:true, status:true, viewCount:true, createdAt:true,
          images:{where:{isPrimary:true},take:1,select:{url:true}} }
      })
    : [];
  const bookings = await prisma.$queryRawUnsafe<any[]>(
    `SELECT b.id, b.product_id AS "productId", b.customer_name AS "customerName", b.customer_phone AS "customerPhone",
      b.preferred_date AS "preferredDate", b.preferred_time AS "preferredTime", b.inspection_location AS "inspectionLocation",
      b.message, b.status, b.seller_note AS "sellerNote", b.created_at AS "createdAt",
      p.name AS "productName", p.slug AS "productSlug"
     FROM cars_bookings b LEFT JOIN products p ON p.id=b.product_id
     WHERE b.cars_store_id=$1 ORDER BY b.created_at DESC LIMIT 100`, store.id
  );
  const counts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE status='CONFIRMED')::int AS confirmed
     FROM cars_bookings WHERE cars_store_id=$1`, store.id
  );
  store.active = store.active !== false;
  res.json({ store, settings: settings[0] ?? { whatsappNumber:store.whatsappNumber ?? null, phoneNumber:null, bookingUrl:null },
    products, bookings, stats:{products:products.length, views:products.reduce((n,p)=>n+Number(p.viewCount||0),0),
      bookings:Number(counts[0]?.total||0), pendingBookings:Number(counts[0]?.pending||0), confirmedBookings:Number(counts[0]?.confirmed||0)} });
}));

carsDashboardRouter.patch("/store", requireAuth, asyncHandler(async (req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  const input=bookingSettingsSchema.parse(req.body);
  await prisma.$executeRawUnsafe(
    `INSERT INTO cars_booking_settings (cars_store_id,whatsapp_number,phone_number,booking_url,updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (cars_store_id) DO UPDATE SET whatsapp_number=EXCLUDED.whatsapp_number,
       phone_number=EXCLUDED.phone_number, booking_url=EXCLUDED.booking_url, updated_at=NOW()`,
    store.id,input.whatsappNumber??null,input.phoneNumber??null,input.bookingUrl??null
  );
  await prisma.$executeRawUnsafe(
    `UPDATE cars_store_profiles SET store_name=COALESCE($2,store_name), location=COALESCE($3,location), whatsapp_number=COALESCE($4,whatsapp_number), updated_at=NOW() WHERE id=$1`,
    store.id,input.storeName??null,input.location??null,input.whatsappNumber??null
  );
  res.json({ok:true});
}));

carsDashboardRouter.patch("/bookings/:id", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  const input=z.object({status:bookingStatusSchema,sellerNote:z.string().trim().max(1000).nullable().optional()}).parse(req.body);
  const rows=await prisma.$queryRawUnsafe<any[]>(
    `UPDATE cars_bookings SET status=$1,seller_note=$2,updated_at=NOW()
     WHERE id=$3 AND cars_store_id=$4 RETURNING id,status,seller_note AS "sellerNote"`,
    input.status,input.sellerNote??null,req.params.id,store.id
  );
  if(!rows[0]) throw AppError.notFound("Booking not found","BOOKING_NOT_FOUND");
  res.json({booking:rows[0]});
}));

carsDashboardRouter.post("/bookings", asyncHandler(async(req,res)=>{
  await ensureCarsDashboardTables();
  const input=z.object({
    listingSlug:z.string().trim().min(1).max(200),
    name:z.string().trim().min(2).max(120),
    phone:z.string().trim().min(5).max(40),
    date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time:z.string().trim().min(2).max(30),
    location:z.string().trim().max(200).nullable().optional(),
    message:z.string().trim().max(2000).nullable().optional(),
  }).parse(req.body);
  const product=await prisma.product.findUnique({where:{slug:input.listingSlug},select:{id:true,name:true,vendorId:true,deletedAt:true,category:{select:{slug:true}}}});
  if(!product || product.deletedAt || product.category?.slug !== "cars") throw AppError.notFound("Vehicle listing not found","LISTING_NOT_FOUND");
  const stores=await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM cars_store_profiles WHERE source_vendor_id=$1 OR user_id=(SELECT user_id FROM vendor_profiles WHERE id=$1) LIMIT 1`,product.vendorId
  );
  if(!stores[0]) throw AppError.notFound("This vehicle is not connected to a TTFL Cars seller","CARS_STORE_NOT_FOUND");
  const id=randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO cars_bookings (id,cars_store_id,product_id,customer_name,customer_phone,preferred_date,preferred_time,inspection_location,message)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9)`,
    id,stores[0].id,product.id,input.name,input.phone,input.date,input.time,input.location??null,input.message??null
  );
  res.status(201).json({ok:true,bookingId:id});
}));

carsDashboardRouter.get("/vehicles/:id", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  if(!store.sourceVendorId) throw AppError.forbidden("Your TTFL Cars store is not connected to an approved seller profile","CARS_VENDOR_REQUIRED");
  const product=await prisma.product.findFirst({
    where:{id:req.params.id,vendorId:store.sourceVendorId,deletedAt:null,category:{slug:"cars"}},
    include:{images:{orderBy:{position:"asc"}}}
  });
  if(!product) throw AppError.notFound("Vehicle not found","VEHICLE_NOT_FOUND");
  res.json({product});
}));

carsDashboardRouter.post("/vehicles", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  if(!store.sourceVendorId) throw AppError.forbidden("Your TTFL Cars store is not connected to an approved seller profile","CARS_VENDOR_REQUIRED");
  const input=createProductSchema.parse({...req.body, categorySlug:"cars"});
  const product=await productsService.createProduct(req.user!.sub,input);
  if(product.vendorId!==store.sourceVendorId) throw AppError.forbidden("Vehicle ownership does not match this Cars store","CARS_STORE_OWNERSHIP_REQUIRED");
  res.status(201).json({product});
}));

carsDashboardRouter.patch("/vehicles/:id", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  if(!store.sourceVendorId) throw AppError.forbidden("Your TTFL Cars store is not connected to an approved seller profile","CARS_VENDOR_REQUIRED");
  const existing=await prisma.product.findUnique({where:{id:req.params.id},select:{id:true,vendorId:true,deletedAt:true,category:{select:{slug:true}}}});
  if(!existing || existing.deletedAt || existing.vendorId!==store.sourceVendorId || existing.category?.slug!=="cars") throw AppError.notFound("Vehicle not found","VEHICLE_NOT_FOUND");
  const input=updateProductSchema.parse({...req.body,categorySlug:"cars"});
  const product=await productsService.updateProduct(req.user!.sub,req.params.id,input as any);
  res.json({product});
}));

carsDashboardRouter.delete("/vehicles/:id", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  if(!store.sourceVendorId) throw AppError.forbidden("Your TTFL Cars store is not connected to an approved seller profile","CARS_VENDOR_REQUIRED");
  const existing=await prisma.product.findUnique({where:{id:req.params.id},select:{id:true,vendorId:true,deletedAt:true,category:{select:{slug:true}}}});
  if(!existing || existing.deletedAt || existing.vendorId!==store.sourceVendorId || existing.category?.slug!=="cars") throw AppError.notFound("Vehicle not found","VEHICLE_NOT_FOUND");
  await productsService.deleteProduct(req.user!.sub,req.params.id);
  res.status(204).send();
}));

carsDashboardRouter.post("/account/deactivate", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  await prisma.$executeRawUnsafe(`UPDATE cars_store_profiles SET active=FALSE,deactivated_at=NOW(),updated_at=NOW() WHERE id=$1`,store.id);
  res.json({ok:true});
}));

carsDashboardRouter.post("/account/reactivate", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  await prisma.$executeRawUnsafe(`UPDATE cars_store_profiles SET active=TRUE,deactivated_at=NULL,updated_at=NOW() WHERE id=$1`,store.id);
  res.json({ok:true});
}));

carsDashboardRouter.delete("/account", requireAuth, asyncHandler(async(req,res)=>{
  const store=await getCarsStore(req.user!.sub);
  if (store.sourceVendorId) {
    await prisma.$executeRawUnsafe(`UPDATE products p SET deleted_at=NOW(), sponsored=FALSE, "sponsoredAt"=NULL FROM categories c WHERE p.category_id=c.id AND p.vendor_id=$1 AND c.slug='cars' AND p.deleted_at IS NULL`, store.sourceVendorId);
  }
  await prisma.$executeRawUnsafe(`DELETE FROM cars_store_profiles WHERE id=$1`,store.id);
  res.json({ok:true});
}));
