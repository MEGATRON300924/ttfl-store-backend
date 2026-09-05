import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";

export const CHECKPOINTS = [
  { checkpoint: 1, title: "Order confirmed" },
  { checkpoint: 2, title: "Order is being packaged" },
  { checkpoint: 3, title: "Order is being shipped" },
  { checkpoint: 4, title: "Order just arrived Destination country" },
  { checkpoint: 5, title: "Order is out for delivery" },
] as const;

function checkpointToStatus(checkpoint: number) { if (checkpoint <= 2) return "PROCESSING" as const; if (checkpoint <= 4) return "SHIPPED" as const; return "OUT_FOR_DELIVERY" as const; }
async function getProductsByIds(productIds: string[]) { if (!productIds.length) return new Map<string, any>(); const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, publicProductId: true, estimatedDeliveryDays: true } }); return new Map(products.map((product) => [product.id, product])); }

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
  if (!vendorOrder || vendorOrder.vendorId !== vendor.id) throw AppError.notFound("Order not found"); const order = await prisma.order.findUnique({ where: { id: vendorOrder.orderId }, select: { createdAt: true } }); if (!order) throw AppError.notFound("Parent order not found"); const products = await getProductsByIds(vendorOrder.items.map((item) => item.productId)); return serializeVendorOrder(vendorOrder, order.createdAt, products);
}

function serializeVendorOrder(vo: any, createdAt: Date, products: Map<string, any>) {
  const latest = vo.trackingEvents[vo.trackingEvents.length - 1] ?? null; const currentCheckpoint = vo.trackingEvents.reduce((max: number, event: any) => Math.max(max, event.checkpoint), 0) || (vo.status === "PROCESSING" ? 1 : vo.status === "SHIPPED" ? 3 : vo.status === "OUT_FOR_DELIVERY" || vo.status === "DELIVERED" ? 5 : 0);
  const days = vo.items.reduce((max: number, item: any) => Math.max(max, Number(products.get(item.productId)?.estimatedDeliveryDays ?? 7)), 0) || 7; const estimatedDeliveryAt = vo.estimatedDeliveryAt ?? new Date(createdAt.getTime() + days * 86400000);
  return { id: vo.id, status: vo.status, estimatedDeliveryAt, vendor: vo.vendor, items: vo.items.map((item: any) => { const product = products.get(item.productId); return { id: item.id, productId: item.productId, publicProductId: product?.publicProductId ?? null, productName: item.productName, quantity: item.quantity, estimatedDeliveryDays: product?.estimatedDeliveryDays ?? 7 }; }), currentCheckpoint, checkpoints: CHECKPOINTS.map((definition) => ({ ...definition, event: vo.trackingEvents.find((event: any) => event.checkpoint === definition.checkpoint) ?? null })), latestEvent: latest };
}

export async function updateCheckpoint(userId: string, vendorOrderId: string, checkpoint: number, description?: string, avatar?: string, trackingUrl?: string, riderName?: string, riderPhone?: string) {
  const definition = CHECKPOINTS.find((item) => item.checkpoint === checkpoint); if (!definition) throw AppError.badRequest("Checkpoint must be between 1 and 5", "INVALID_CHECKPOINT"); const vendor = await getVendorProfileForUser(userId);
  const order = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId }, include: { trackingEvents: true } }); if (!order || order.vendorId !== vendor.id) throw AppError.notFound("Order not found"); if (order.status === "CANCELLED" || order.status === "DELIVERED") throw AppError.badRequest("A cancelled or delivered order cannot have its tracking changed", "TRACKING_LOCKED");
  if (checkpoint === 5 && !description?.trim() && !trackingUrl?.trim() && !riderName?.trim()) throw AppError.badRequest("Add rider details or a tracking link for the delivery checkpoint", "DELIVERY_DETAILS_REQUIRED");
  const event = await prisma.trackingEvent.upsert({ where: { vendorOrderId_checkpoint: { vendorOrderId, checkpoint } }, create: { vendorOrderId, checkpoint, title: definition.title, description: description?.trim() || null, avatar: avatar || "package", trackingUrl: trackingUrl?.trim() || null, riderName: riderName?.trim() || null, riderPhone: riderPhone?.trim() || null }, update: { description: description?.trim() || null, avatar: avatar || "package", trackingUrl: trackingUrl?.trim() || null, riderName: riderName?.trim() || null, riderPhone: riderPhone?.trim() || null } });
  const highestCheckpoint = Math.max(checkpoint, ...order.trackingEvents.map((existing) => existing.checkpoint)); const updated = await prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: checkpointToStatus(highestCheckpoint) }, include: { trackingEvents: { orderBy: { checkpoint: "asc" } } } }); return { order: updated, event };
}
