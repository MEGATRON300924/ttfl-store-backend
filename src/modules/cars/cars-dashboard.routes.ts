import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const carsDashboardRouter = Router();

async function ensureCarsDashboardTables() {
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
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cars_bookings_store_idx ON cars_bookings(cars_store_id, created_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cars_bookings_product_idx ON cars_bookings(product_id)`);
}

async function getCarsStore(userId: string) {
  await ensureCarsDashboardTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, user_id AS "userId", source_vendor_id AS "sourceVendorId", store_name AS "storeName", store_slug AS "storeSlug",
      location, whatsapp_number AS "whatsappNumber", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM cars_store_profiles WHERE user_id = $1 LIMIT 1`, userId
  );
  if (!rows[0]) throw AppError.notFound("Your TTFL Cars store was not found", "CARS_STORE_NOT_FOUND");
  return rows[0];
}

const bookingSettingsSchema = z.object({
  whatsappNumber: z.string().trim().max(30).nullable().optional(),
  phoneNumber: z.string().trim().max(30).nullable().optional(),
  bookingUrl: z.string().trim().url().max(500).nullable().optional(),
});

const bookingStatusSchema = z.enum(["PENDING","CONFIRMED","RESCHEDULED","DECLINED","COMPLETED","CANCELLED"]);

carsDashboardRouter.get("/dashboard", requireAuth, asyncHandler(async (req, res) => {
  const store = await getCarsStore(req.user!.sub);
  const settings = await prisma.$queryRawUnsafe<any[]>(
    `SELECT whatsapp_number AS "whatsappNumber", phone_number AS "phoneNumber", booking_url AS "bookingUrl"
     FROM cars_booking_settings WHERE cars_store_id = $1 LIMIT 1`, store.id
  );
  const products = store.sourceVendorId
    ? await prisma.product.findMany({
        where: { vendorId: store.sourceVendorId, deletedAt: null },
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
    `UPDATE cars_store_profiles SET whatsapp_number=COALESCE($2,whatsapp_number), updated_at=NOW() WHERE id=$1`,
    store.id,input.whatsappNumber??null
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
  const product=await prisma.product.findUnique({where:{slug:input.listingSlug},select:{id:true,name:true,vendorId:true}});
  if(!product) throw AppError.notFound("Vehicle listing not found","LISTING_NOT_FOUND");
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
