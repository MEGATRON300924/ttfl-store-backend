import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { initializeTransaction, verifyTransaction } from "@/lib/paystack";
import { resolveCommissionRate, calculateCommission } from "@/lib/commissions";
import { ensureServiceTables } from "./services.service";

export const SERVICE_ORDER_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export async function ensureServiceOrderTables() {
  await ensureServiceTables();
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS service_orders (id TEXT PRIMARY KEY,service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,vendor_id TEXT NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,amount NUMERIC(14,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'NGN',commission_rate NUMERIC(8,4) NOT NULL DEFAULT 0,commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,vendor_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,payment_reference TEXT NOT NULL UNIQUE,payment_status TEXT NOT NULL DEFAULT 'PENDING',status TEXT NOT NULL DEFAULT 'PENDING',booking_date DATE,booking_time TEXT,location TEXT,notes TEXT,paid_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK (payment_status IN ('PENDING','PAID','FAILED')),CHECK (status IN ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED')))`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS service_orders_customer_idx ON service_orders(customer_id,created_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS service_orders_vendor_idx ON service_orders(vendor_id,created_at DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS service_orders_service_idx ON service_orders(service_id,created_at DESC)`);
}

async function getServiceForCheckout(serviceIdOrSlug: string) {
  await ensureServiceTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT s.*,vp."storeName" AS "storeName",vp."storeSlug" AS "storeSlug",vp."logoUrl" AS "storeLogoUrl",vp.verified FROM services s JOIN vendor_profiles vp ON vp.id=s.vendor_id WHERE (s.id=$1 OR s.slug=$1) AND s.status='ACTIVE' AND vp.status='APPROVED' LIMIT 1`, serviceIdOrSlug);
  if (!rows[0]) throw AppError.notFound("Service not found");
  return rows[0];
}

export async function createServiceOrder(customerId: string, customerEmail: string, serviceIdOrSlug: string, input: { bookingDate?: string | null; bookingTime?: string | null; location?: string | null; notes?: string | null }) {
  await ensureServiceOrderTables();
  const service = await getServiceForCheckout(serviceIdOrSlug);
  if (service.price_type === "QUOTE" || service.price == null) throw AppError.badRequest("This service requires a quote before payment", "SERVICE_REQUIRES_QUOTE");
  const amount = Number(service.price);
  if (!Number.isFinite(amount) || amount < 0) throw AppError.badRequest("This service does not have a valid price", "INVALID_SERVICE_PRICE");
  if (service.booking_required && !input.bookingDate) throw AppError.badRequest("Please choose a booking date", "BOOKING_DATE_REQUIRED");
  if (service.booking_required && !input.bookingTime) throw AppError.badRequest("Please choose a booking time", "BOOKING_TIME_REQUIRED");
  if (input.bookingDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.bookingDate)) throw AppError.badRequest("Invalid booking date", "INVALID_BOOKING_DATE");

  const commissionRate = await resolveCommissionRate(service.vendor_id);
  const { commissionAmount, vendorEarnings } = calculateCommission(amount, commissionRate);
  const id = randomUUID();
  const paymentReference = `ttfl_service_${id}_${Date.now()}`;

  await prisma.$executeRawUnsafe(`INSERT INTO service_orders (id,service_id,vendor_id,customer_id,amount,currency,commission_rate,commission_amount,vendor_earnings,payment_reference,status,payment_status,booking_date,booking_time,location,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING','PENDING',$11,$12,$13,$14)`, id, service.id, service.vendor_id, customerId, amount, service.currency ?? "NGN", commissionRate, commissionAmount, vendorEarnings, paymentReference, input.bookingDate || null, input.bookingTime?.trim() || null, input.location?.trim() || null, input.notes?.trim() || null);

  try {
    const paystack = await initializeTransaction({
      email: customerEmail,
      amountNaira: amount,
      reference: paymentReference,
      callbackUrl: `${env.appUrl}/services/${encodeURIComponent(service.slug)}/confirm`,
      metadata: { kind: "ttfl_service_order", serviceOrderId: id, serviceId: service.id, serviceSlug: service.slug },
      split: await buildServiceSplit(service.vendor_id, vendorEarnings, paymentReference),
    });
    return { serviceOrder: await getServiceOrderById(id, customerId, false), checkoutUrl: paystack.authorization_url };
  } catch (error) {
    await prisma.$executeRawUnsafe(`DELETE FROM service_orders WHERE id=$1`, id);
    throw error;
  }
}

async function buildServiceSplit(vendorId: string, vendorEarnings: number, reference: string) {
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId }, select: { paystackSubaccountCode: true, storeName: true } });
  if (!vendor?.paystackSubaccountCode) throw AppError.badRequest(`Payment cannot start because ${vendor?.storeName ?? "this vendor"} has not configured a payout account`, "VENDOR_PAYOUT_NOT_CONFIGURED");
  return { type: "flat" as const, bearer_type: "account" as const, subaccounts: [{ subaccount: vendor.paystackSubaccountCode, share: Math.round(vendorEarnings * 100) }], reference: `ttfl_service_split_${reference}` };
}

export async function verifyAndFinalizeServicePayment(reference: string) {
  await ensureServiceOrderTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM service_orders WHERE payment_reference=$1 LIMIT 1`, reference);
  const order = rows[0];
  if (!order) throw AppError.notFound("Service order not found for this payment reference");
  if (order.payment_status === "PAID") return getServiceOrderById(order.id, order.customer_id, true);
  const verification = await verifyTransaction(reference);
  if (verification.status !== "success") {
    await prisma.$executeRawUnsafe(`UPDATE service_orders SET payment_status='FAILED',updated_at=NOW() WHERE id=$1`, order.id);
    throw AppError.badRequest("Payment was not successful", "PAYMENT_FAILED");
  }
  const paidAmount = verification.amount / 100;
  if (Math.round(paidAmount) !== Math.round(Number(order.amount))) throw AppError.badRequest("Payment amount does not match service total", "AMOUNT_MISMATCH");
  await prisma.$executeRawUnsafe(`UPDATE service_orders SET payment_status='PAID',status='CONFIRMED',paid_at=NOW(),updated_at=NOW() WHERE id=$1`, order.id);
  return getServiceOrderById(order.id, order.customer_id, true);
}

export async function getServiceOrderById(id: string, requesterId: string, allowVendor = true) {
  await ensureServiceOrderTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT so.*,s.title AS "serviceTitle",s.slug AS "serviceSlug",s.description AS "serviceDescription",s.booking_required AS "bookingRequired",vp."storeName" AS "storeName",vp."storeSlug" AS "storeSlug",vp."logoUrl" AS "storeLogoUrl" FROM service_orders so JOIN services s ON s.id=so.service_id JOIN vendor_profiles vp ON vp.id=so.vendor_id WHERE so.id=$1 LIMIT 1`, id);
  if (!rows[0]) throw AppError.notFound("Service order not found");
  if (rows[0].customer_id !== requesterId) {
    if (!allowVendor) throw AppError.forbidden("You don't have access to this service order");
    const vendor = await getVendorProfileForUser(requesterId);
    if (vendor.id !== rows[0].vendor_id) throw AppError.forbidden("You don't have access to this service order");
  }
  return rows[0];
}

export async function getMyServiceOrders(customerId: string) {
  await ensureServiceOrderTables();
  return prisma.$queryRawUnsafe<any[]>(`SELECT so.*,s.title AS "serviceTitle",s.slug AS "serviceSlug",vp."storeName" AS "storeName",vp."storeSlug" AS "storeSlug",vp."logoUrl" AS "storeLogoUrl" FROM service_orders so JOIN services s ON s.id=so.service_id JOIN vendor_profiles vp ON vp.id=so.vendor_id WHERE so.customer_id=$1 ORDER BY so.created_at DESC`, customerId);
}

export async function getMyVendorServiceOrders(userId: string) {
  await ensureServiceOrderTables();
  const vendor = await getVendorProfileForUser(userId);
  return prisma.$queryRawUnsafe<any[]>(`SELECT so.*,s.title AS "serviceTitle",s.slug AS "serviceSlug",u."email" AS "customerEmail",u."firstName" AS "customerFirstName",u."lastName" AS "customerLastName" FROM service_orders so JOIN services s ON s.id=so.service_id JOIN users u ON u.id=so.customer_id WHERE so.vendor_id=$1 ORDER BY so.created_at DESC`, vendor.id);
}

export async function updateVendorServiceOrderStatus(userId: string, id: string, nextStatus: ServiceOrderStatus) {
  await ensureServiceOrderTables();
  const vendor = await getVendorProfileForUser(userId);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT status FROM service_orders WHERE id=$1 AND vendor_id=$2 LIMIT 1`, id, vendor.id);
  if (!rows[0]) throw AppError.notFound("Service order not found");
  const current = rows[0].status as ServiceOrderStatus;
  const transitions: Record<ServiceOrderStatus, ServiceOrderStatus[]> = { PENDING: ["CANCELLED"], CONFIRMED: ["IN_PROGRESS","CANCELLED"], IN_PROGRESS: ["COMPLETED","CANCELLED"], COMPLETED: [], CANCELLED: [] };
  if (!transitions[current].includes(nextStatus)) throw AppError.badRequest(`Can't move a service order from ${current} to ${nextStatus}`, "INVALID_STATUS_TRANSITION");
  await prisma.$executeRawUnsafe(`UPDATE service_orders SET status=$1,updated_at=NOW() WHERE id=$2 AND vendor_id=$3`, nextStatus, id, vendor.id);
  return getServiceOrderById(id, userId, true);
}
