import { createHmac, timingSafeEqual, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { env } from "@/config/env";
import { sendEmail, orderTrackingCheckpointEmail } from "@/lib/email";
import { createNotification } from "@/modules/notifications/notifications.service";
import { logger } from "@/lib/logger";

export const CHECKPOINTS = [
  { checkpoint: 1, title: "Order confirmed" },
  { checkpoint: 2, title: "Order is being packaged" },
  { checkpoint: 3, title: "Order is being shipped" },
  { checkpoint: 4, title: "Order just arrived Destination country" },
  { checkpoint: 5, title: "Order is out for delivery" },
] as const;

function checkpointToStatus(checkpoint: number) { if (checkpoint <= 2) return "PROCESSING" as const; if (checkpoint <= 4) return "SHIPPED" as const; return "OUT_FOR_DELIVERY" as const; }
async function getProductsByIds(productIds: string[]) { if (!productIds.length) return new Map<string, any>(); const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, publicProductId: true, estimatedDeliveryDays: true } }); return new Map(products.map((product) => [product.id, product])); }
function base64Url(value: string) { return Buffer.from(value).toString("base64url"); }
function fromBase64Url(value: string) { return Buffer.from(value, "base64url").toString("utf8"); }
function signTrackingPayload(payload: string) { return createHmac("sha256", env.jwt.accessSecret).update(payload).digest("base64url"); }
function hashRiderAccessToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export function createPublicTrackingToken(orderNumber: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, env.whatsapp.trackingLinkTtlDays) * 86400;
  const payload = base64Url(JSON.stringify({ orderNumber, expiresAt }));
  return `${payload}.${signTrackingPayload(payload)}`;
}

export function createDriverContactToken(vendorOrderId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, env.whatsapp.trackingLinkTtlDays) * 86400;
  const payload = base64Url(JSON.stringify({ vendorOrderId, expiresAt, purpose: "driver-contact" }));
  return `${payload}.${signTrackingPayload(payload)}`;
}

function verifySignedToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw AppError.unauthorized("Invalid secure link", "INVALID_SECURE_LINK");
  const expected = signTrackingPayload(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) throw AppError.unauthorized("Invalid secure link", "INVALID_SECURE_LINK");
  let parsed: any;
  try { parsed = JSON.parse(fromBase64Url(payload)); } catch { throw AppError.unauthorized("Invalid secure link", "INVALID_SECURE_LINK"); }
  if (!parsed.expiresAt || parsed.expiresAt < Math.floor(Date.now() / 1000)) throw AppError.unauthorized("This secure link has expired", "SECURE_LINK_EXPIRED");
  return parsed;
}

function verifyPublicTrackingToken(token: string) {
  const parsed = verifySignedToken(token);
  if (!parsed.orderNumber) throw AppError.unauthorized("Invalid tracking link", "INVALID_TRACKING_LINK");
  return parsed.orderNumber as string;
}

export async function getDriverContactByToken(token: string) {
  const parsed = verifySignedToken(token);
  if (parsed.purpose !== "driver-contact" || !parsed.vendorOrderId) throw AppError.unauthorized("Invalid driver contact link", "INVALID_DRIVER_LINK");
  const vendorOrder = await prisma.vendorOrder.findUnique({
    where: { id: parsed.vendorOrderId },
    include: { trackingEvents: { where: { checkpoint: 5 }, take: 1 }, vendor: { select: { storeName: true, storeSlug: true } } },
  });
  if (!vendorOrder) throw AppError.notFound("Delivery order not found");
  if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(vendorOrder.status)) throw AppError.badRequest("The delivery driver is not currently assigned to this order", "DRIVER_NOT_AVAILABLE");
  const event = vendorOrder.trackingEvents[0];
  if (!event?.riderPhone) throw AppError.notFound("A delivery driver contact number has not been assigned yet", "DRIVER_CONTACT_NOT_AVAILABLE");
  return { storeName: vendorOrder.vendor.storeName, storeSlug: vendorOrder.vendor.storeSlug, riderName: event.riderName ?? "Delivery driver", riderPhone: event.riderPhone.replace(/\D/g, "") };
}

export async function trackByPublicToken(token: string) {
  const orderNumber = verifyPublicTrackingToken(token);
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { vendorOrders: { include: { items: true, vendor: { select: { id: true, storeName: true, storeSlug: true, verified: true } }, trackingEvents: { orderBy: { checkpoint: "asc" } } } } } });
  if (!order) throw AppError.notFound("Order not found");
  const products = await getProductsByIds(order.vendorOrders.flatMap((vo) => vo.items.map((item) => item.productId)));
  return { orderNumber: order.orderNumber, createdAt: order.createdAt, paymentStatus: order.paymentStatus, vendorOrders: order.vendorOrders.map((vo) => serializeVendorOrder(vo, order.createdAt, products, order.deliveryLatitude, order.deliveryLongitude)) };
}

export async function trackPublic(orderNumber: string, productId: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { vendorOrders: { include: { items: true, vendor: { select: { id: true, storeName: true, storeSlug: true, verified: true } }, trackingEvents: { orderBy: { checkpoint: "asc" } } } } } });
  if (!order) throw AppError.notFound("Order not found"); const products = await getProductsByIds(order.vendorOrders.flatMap((vo) => vo.items.map((item) => item.productId)));
  const vendorOrders = order.vendorOrders.map((vo) => ({ ...vo, items: vo.items.filter((item) => item.productId === productId || products.get(item.productId)?.publicProductId === productId) })).filter((vo) => vo.items.length > 0);
  if (!vendorOrders.length) throw AppError.notFound("That Product ID is not part of this order"); return { orderNumber: order.orderNumber, createdAt: order.createdAt, paymentStatus: order.paymentStatus, vendorOrders: vendorOrders.map((vo) => serializeVendorOrder(vo, order.createdAt, products)) };
}

export async function trackAuthenticated(orderNumber: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { vendorOrders: { include: { items: true, vendor: { select: { id: true, storeName: true, storeSlug: true, verified: true } }, trackingEvents: { orderBy: { checkpoint: "asc" } } } } } });
  if (!order) throw AppError.notFound("Order not found"); if (order.customerId !== userId) throw AppError.forbidden("You don't have access to this order"); const products = await getProductsByIds(order.vendorOrders.flatMap((vo) => vo.items.map((item) => item.productId)));
  return { orderNumber: order.orderNumber, createdAt: order.createdAt, paymentStatus: order.paymentStatus, vendorOrders: order.vendorOrders.map((vo) => serializeVendorOrder(vo, order.createdAt, products)) };
}

export async function getVendorOrderTracking(userId: string, vendorOrderId: string) {
  const vendor = await getVendorProfileForUser(userId); const vendorOrder = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId }, include: { items: true, vendor: { select: { id: true, storeName: true, storeSlug: true, verified: true } }, trackingEvents: { orderBy: { checkpoint: "asc" } } } });
  if (!vendorOrder || vendorOrder.vendorId !== vendor.id) throw AppError.notFound("Order not found"); const order = await prisma.order.findUnique({ where: { id: vendorOrder.orderId }, select: { createdAt: true, deliveryLatitude: true, deliveryLongitude: true } }); if (!order) throw AppError.notFound("Parent order not found"); const products = await getProductsByIds(vendorOrder.items.map((item) => item.productId)); return serializeVendorOrder(vendorOrder, order.createdAt, products, order.deliveryLatitude, order.deliveryLongitude);
}

function serializeVendorOrder(vo: any, createdAt: Date, products: Map<string, any>, destinationLatitude?: number | null, destinationLongitude?: number | null) {
  const latest = vo.trackingEvents[vo.trackingEvents.length - 1] ?? null; const currentCheckpoint = vo.trackingEvents.reduce((max: number, event: any) => Math.max(max, event.checkpoint), 0) || (vo.status === "PROCESSING" ? 1 : vo.status === "SHIPPED" ? 3 : vo.status === "OUT_FOR_DELIVERY" || vo.status === "DELIVERED" ? 5 : 0);
  const days = vo.items.reduce((max: number, item: any) => Math.max(max, Number(products.get(item.productId)?.estimatedDeliveryDays ?? 7)), 0) || 7; const estimatedDeliveryAt = vo.estimatedDeliveryAt ?? new Date(createdAt.getTime() + days * 86400000);
  const locationIsFresh = vo.status === "OUT_FOR_DELIVERY" && vo.driverLocationUpdatedAt && Date.now() - new Date(vo.driverLocationUpdatedAt).getTime() <= 120000;
  return { id: vo.id, status: vo.status, estimatedDeliveryAt, liveLocation: locationIsFresh ? { latitude: vo.driverLatitude, longitude: vo.driverLongitude, accuracy: vo.driverAccuracy, heading: vo.driverHeading, speed: vo.driverSpeed, updatedAt: vo.driverLocationUpdatedAt } : null, deliveryDestination: destinationLatitude != null && destinationLongitude != null ? { latitude: destinationLatitude, longitude: destinationLongitude } : null, vendor: vo.vendor, items: vo.items.map((item: any) => { const product = products.get(item.productId); return { id: item.id, productId: item.productId, publicProductId: product?.publicProductId ?? null, productName: item.productName, quantity: item.quantity, estimatedDeliveryDays: product?.estimatedDeliveryDays ?? 7 }; }), currentCheckpoint, checkpoints: CHECKPOINTS.map((definition) => ({ ...definition, event: vo.trackingEvents.find((event: any) => event.checkpoint === definition.checkpoint) ?? null })), latestEvent: latest };
}

export async function updateCheckpoint(userId: string, vendorOrderId: string, checkpoint: number, description?: string, avatar?: string, trackingUrl?: string, riderName?: string, riderPhone?: string) {
  const definition = CHECKPOINTS.find((item) => item.checkpoint === checkpoint); if (!definition) throw AppError.badRequest("Checkpoint must be between 1 and 5", "INVALID_CHECKPOINT"); const vendor = await getVendorProfileForUser(userId);
  const order = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId }, include: { trackingEvents: true } }); if (!order || order.vendorId !== vendor.id) throw AppError.notFound("Order not found"); if (order.status === "CANCELLED" || order.status === "DELIVERED") throw AppError.badRequest("A cancelled or delivered order cannot have its tracking changed", "TRACKING_LOCKED");
  if (checkpoint === 5 && !description?.trim() && !trackingUrl?.trim() && !riderName?.trim() && !riderPhone?.trim()) throw AppError.badRequest("Add rider details or a tracking link for the delivery checkpoint", "DELIVERY_DETAILS_REQUIRED");
  const existingEvent = order.trackingEvents.find((existing) => existing.checkpoint === checkpoint);
  const event = await prisma.trackingEvent.upsert({ where: { vendorOrderId_checkpoint: { vendorOrderId, checkpoint } }, create: { vendorOrderId, checkpoint, title: definition.title, description: description?.trim() || null, avatar: avatar || "package", trackingUrl: trackingUrl?.trim() || null, riderName: riderName?.trim() || null, riderPhone: riderPhone?.trim() || null }, update: { description: description?.trim() || null, avatar: avatar || "package", trackingUrl: trackingUrl?.trim() || null, riderName: riderName?.trim() || null, riderPhone: riderPhone?.trim() || null } });
  const highestCheckpoint = Math.max(checkpoint, ...order.trackingEvents.map((existing) => existing.checkpoint));
  const updated = await prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: checkpointToStatus(highestCheckpoint) }, include: { trackingEvents: { orderBy: { checkpoint: "asc" } } } });

  if (!existingEvent) {
    const parentOrder = await prisma.order.findUnique({
      where: { id: order.orderId },
      select: { orderNumber: true, customerId: true }
    });
    if (parentOrder) {
      const customer = await prisma.user.findUnique({ where: { id: parentOrder.customerId }, select: { email: true } });
      if (customer) {
        void sendEmail({
          to: customer.email,
          ...orderTrackingCheckpointEmail(parentOrder.orderNumber, checkpoint as 1 | 2 | 3 | 4 | 5, description)
        }).catch((error) => logger.warn("Failed to send order checkpoint email", {
          orderId: order.orderId,
          vendorOrderId,
          checkpoint,
          error
        }));
      }
      void createNotification(parentOrder.customerId, {
        title: definition.title,
        body: description?.trim() || definition.title,
        type: "ORDER",
        url: `/orders/${encodeURIComponent(parentOrder.orderNumber)}`,
        data: {
          type: `order.checkpoint_${checkpoint}`,
          orderNumber: parentOrder.orderNumber,
          checkpoint
        }
      }).catch((error) => logger.warn("Failed to create checkpoint notification", {
        orderId: order.orderId,
        vendorOrderId,
        checkpoint,
        error
      }));
    }
  }

  return { order: updated, event };
}

export async function listAdminTtflDeliveries() {
  const deliveries = await prisma.vendorOrder.findMany({
    where: {
      deliveryMethod: "TTFL",
      status: { in: ["PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY"] },
      order: { paymentStatus: "PAID" },
    },
    include: {
      order: { select: { orderNumber: true, paymentStatus: true, deliveryName: true, deliveryPhone: true, deliveryLine1: true, deliveryLine2: true, deliveryCity: true, deliveryState: true, deliveryPostcode: true, createdAt: true, customer: { select: { firstName: true, lastName: true, email: true } } } },
      vendor: { select: { id: true, storeName: true, storeSlug: true } },
      items: { select: { productName: true, quantity: true } },
      trackingEvents: { where: { checkpoint: 5 }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return deliveries.map((delivery) => ({
    id: delivery.id,
    orderNumber: delivery.order.orderNumber,
    status: delivery.status,
    createdAt: delivery.order.createdAt,
    customer: {
      name: delivery.order.deliveryName,
      phone: delivery.order.deliveryPhone,
      email: delivery.order.customer.email,
    },
    address: [delivery.order.deliveryLine1, delivery.order.deliveryLine2, delivery.order.deliveryCity, delivery.order.deliveryState, delivery.order.deliveryPostcode].filter(Boolean).join(", "),
    vendor: delivery.vendor,
    items: delivery.items,
    rider: delivery.trackingEvents[0] ? {
      name: delivery.trackingEvents[0].riderName,
      phone: delivery.trackingEvents[0].riderPhone,
      trackingUrl: delivery.trackingEvents[0].trackingUrl,
    } : null,
  }));
}

export async function assignTtflDriver(
  vendorOrderId: string,
  input: { riderName: string; riderPhone: string; trackingUrl?: string; description?: string },
) {
  const vendorOrder = await prisma.vendorOrder.findUnique({
    where: { id: vendorOrderId },
    include: {
      order: { include: { customer: { select: { id: true, email: true, firstName: true } } } },
      vendor: { select: { storeName: true, storeSlug: true } },
      trackingEvents: true,
    },
  });
  if (!vendorOrder) throw AppError.notFound("Delivery order not found", "DELIVERY_ORDER_NOT_FOUND");
  if (vendorOrder.deliveryMethod !== "TTFL") throw AppError.badRequest("This order is not assigned to TTFL delivery", "NOT_TTFL_DELIVERY");
  if (vendorOrder.order.paymentStatus !== "PAID") throw AppError.badRequest("Only paid orders can be dispatched", "ORDER_NOT_PAID");
  if (["CANCELLED", "DELIVERED", "REFUNDED"].includes(vendorOrder.status)) throw AppError.badRequest("This order can no longer be dispatched", "DELIVERY_LOCKED");

  const definition = CHECKPOINTS[4];
  const description = input.description?.trim() || "A TTFL delivery rider has been assigned to your order.";
  const existingEvent = vendorOrder.trackingEvents.find((event) => event.checkpoint === 5);
  const riderAccessToken = randomBytes(32).toString("base64url");
  const riderAccessExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const event = await prisma.trackingEvent.upsert({
    where: { vendorOrderId_checkpoint: { vendorOrderId, checkpoint: 5 } },
    create: { vendorOrderId, checkpoint: 5, title: definition.title, description, avatar: "motorcycle", trackingUrl: input.trackingUrl?.trim() || null, riderName: input.riderName.trim(), riderPhone: input.riderPhone.trim() },
    update: { description, avatar: "motorcycle", trackingUrl: input.trackingUrl?.trim() || null, riderName: input.riderName.trim(), riderPhone: input.riderPhone.trim() },
  });
  const updated = await prisma.vendorOrder.update({
    where: { id: vendorOrderId },
    data: { status: "OUT_FOR_DELIVERY", driverAccessTokenHash: hashRiderAccessToken(riderAccessToken), driverAccessExpiresAt: riderAccessExpiresAt, driverLatitude: null, driverLongitude: null, driverAccuracy: null, driverHeading: null, driverSpeed: null, driverLocationUpdatedAt: null },
  });
  if (!existingEvent) {
    void sendEmail({
      to: vendorOrder.order.customer.email,
      ...orderTrackingCheckpointEmail(vendorOrder.order.orderNumber, 5, description),
    }).catch((error) => logger.warn("Failed to send TTFL rider assignment email", { vendorOrderId, error }));
  }
  void createNotification(vendorOrder.order.customer.id, {
    title: "TTFL rider assigned",
    body: description,
    type: "ORDER",
    url: "/orders/" + encodeURIComponent(vendorOrder.order.orderNumber),
    data: { type: "order.ttfl_rider_assigned", orderNumber: vendorOrder.order.orderNumber, riderName: input.riderName.trim() },
  }).catch((error) => logger.warn("Failed to create TTFL rider assignment notification", { vendorOrderId, error }));
  return { vendorOrder: updated, event, riderAccessToken, riderAccessExpiresAt, message: "TTFL delivery rider assigned." };
}

export async function getRiderAssignment(token: string) {
  if (!token || token.length < 32 || token.length > 200) throw AppError.unauthorized("This rider link is invalid or expired.", "RIDER_LINK_INVALID");
  const now = new Date();
  const vendorOrder = await prisma.vendorOrder.findFirst({
    where: { driverAccessTokenHash: hashRiderAccessToken(token), driverAccessExpiresAt: { gt: now }, deliveryMethod: "TTFL", status: "OUT_FOR_DELIVERY", order: { paymentStatus: "PAID" } },
    include: { order: { select: { orderNumber: true, deliveryName: true, deliveryPhone: true, deliveryLine1: true, deliveryLine2: true, deliveryCity: true, deliveryState: true, deliveryLatitude: true, deliveryLongitude: true } }, vendor: { select: { storeName: true } }, items: { select: { productName: true, quantity: true } } },
  });
  if (!vendorOrder) throw AppError.unauthorized("This rider link is invalid, expired or no longer assigned.", "RIDER_LINK_INVALID");
  return { orderNumber: vendorOrder.order.orderNumber, status: vendorOrder.status, restaurant: vendorOrder.vendor.storeName, delivery: { name: vendorOrder.order.deliveryName, phone: vendorOrder.order.deliveryPhone, address: [vendorOrder.order.deliveryLine1, vendorOrder.order.deliveryLine2, vendorOrder.order.deliveryCity, vendorOrder.order.deliveryState].filter(Boolean).join(", "), latitude: vendorOrder.order.deliveryLatitude, longitude: vendorOrder.order.deliveryLongitude }, items: vendorOrder.items };
}

export async function updateRiderLocation(token: string, input: { latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number }) {
  if (!token || token.length < 32 || token.length > 200) throw AppError.unauthorized("This rider link is invalid or expired.", "RIDER_LINK_INVALID");
  const now = new Date();
  const vendorOrder = await prisma.vendorOrder.findFirst({ where: { driverAccessTokenHash: hashRiderAccessToken(token), driverAccessExpiresAt: { gt: now }, deliveryMethod: "TTFL", status: "OUT_FOR_DELIVERY", order: { paymentStatus: "PAID" } }, select: { id: true } });
  if (!vendorOrder) throw AppError.unauthorized("This rider link is invalid, expired or no longer assigned.", "RIDER_LINK_INVALID");
  const updated = await prisma.vendorOrder.updateMany({ where: { id: vendorOrder.id, driverAccessTokenHash: hashRiderAccessToken(token), driverAccessExpiresAt: { gt: now }, status: "OUT_FOR_DELIVERY" }, data: { driverLatitude: input.latitude, driverLongitude: input.longitude, driverAccuracy: input.accuracy ?? null, driverHeading: input.heading ?? null, driverSpeed: input.speed ?? null, driverLocationUpdatedAt: now } });
  if (updated.count !== 1) throw AppError.unauthorized("This rider assignment is no longer active.", "RIDER_LINK_INVALID");
  return { accepted: true, updatedAt: now };
}

export async function stopRiderLocation(token: string) {
  if (!token || token.length < 32 || token.length > 200) throw AppError.unauthorized("This rider link is invalid or expired.", "RIDER_LINK_INVALID");
  const updated = await prisma.vendorOrder.updateMany({ where: { driverAccessTokenHash: hashRiderAccessToken(token), driverAccessExpiresAt: { gt: new Date() }, status: "OUT_FOR_DELIVERY" }, data: { driverAccessTokenHash: null, driverAccessExpiresAt: null, driverLatitude: null, driverLongitude: null, driverAccuracy: null, driverHeading: null, driverSpeed: null, driverLocationUpdatedAt: null } });
  if (updated.count !== 1) throw AppError.unauthorized("This rider assignment is no longer active.", "RIDER_LINK_INVALID");
  return { stopped: true };
}