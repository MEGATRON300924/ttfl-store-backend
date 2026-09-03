import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const CHECKPOINTS = [
  { checkpoint: 1, title: "Order confirmed" },
  { checkpoint: 2, title: "Order is being packaged" },
  { checkpoint: 3, title: "Order is being shipped" },
  { checkpoint: 4, title: "Order just arrived Destination country" },
  { checkpoint: 5, title: "Order is out for delivery" },
] as const;

function checkpointToStatus(checkpoint: number) {
  if (checkpoint <= 2) return "PROCESSING" as const;
  if (checkpoint <= 4) return "SHIPPED" as const;
  return "OUT_FOR_DELIVERY" as const;
}

export async function trackPublic(orderNumber: string, productId: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { vendorOrders: { include: { items: { where: { product: { publicProductId: productId } }, include: { product: true } }, vendor: { select: { id: true, storeName: true, storeSlug: true, verified: true } }, trackingEvents: { orderBy: { checkpoint: "asc" } } } } } });
  if (!order) throw AppError.notFound("Order not found");
  const vendorOrders = order.vendorOrders.filter((vo) => vo.items.length > 0);
  if (!vendorOrders.length) throw AppError.notFound("That product is not part of this order");
  return { orderNumber: order.orderNumber, createdAt: order.createdAt, paymentStatus: order.paymentStatus, vendorOrders: vendorOrders.map(serializeVendorOrder) };
}

export async function trackAuthenticated(orderNumber: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { vendorOrders: { include: { items: { include: { product: true } }, vendor: { select: { id: true, storeName: true, storeSlug: true, verified: true } }, trackingEvents: { orderBy: { checkpoint: "asc" } } } } } });
  if (!order) throw AppError.notFound("Order not found");
  if (order.customerId !== userId) throw AppError.forbidden("You don't have access to this order");
  return { orderNumber: order.orderNumber, createdAt: order.createdAt, paymentStatus: order.paymentStatus, vendorOrders: order.vendorOrders.map(serializeVendorOrder) };
}

function serializeVendorOrder(vo: any) {
  const latest = vo.trackingEvents[vo.trackingEvents.length - 1] ?? null;
  const currentCheckpoint = latest?.checkpoint ?? (vo.status === "PROCESSING" ? 1 : vo.status === "SHIPPED" ? 3 : vo.status === "OUT_FOR_DELIVERY" || vo.status === "DELIVERED" ? 5 : 0);
  return {
    id: vo.id,
    status: vo.status,
    estimatedDeliveryAt: vo.estimatedDeliveryAt,
    vendor: vo.vendor,
    items: vo.items.map((item: any) => ({ id: item.id, productId: item.productId, publicProductId: item.product.publicProductId, productName: item.productName, quantity: item.quantity, estimatedDeliveryDays: item.product.estimatedDeliveryDays })),
    currentCheckpoint,
    checkpoints: CHECKPOINTS.map((definition) => ({ ...definition, event: vo.trackingEvents.find((event: any) => event.checkpoint === definition.checkpoint) ?? null })),
  };
}

export async function updateCheckpoint(userId: string, vendorOrderId: string, checkpoint: number, description?: string, avatar?: string, trackingUrl?: string, riderName?: string, riderPhone?: string) {
  const definition = CHECKPOINTS.find((item) => item.checkpoint === checkpoint);
  if (!definition) throw AppError.badRequest("Checkpoint must be between 1 and 5", "INVALID_CHECKPOINT");
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  const order = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId }, include: { trackingEvents: true } });
  if (!order || order.vendorId !== vendor.id) throw AppError.notFound("Order not found");
  const latestCheckpoint = order.trackingEvents.reduce((max, event) => Math.max(max, event.checkpoint), 0);
  if (checkpoint < latestCheckpoint) throw AppError.badRequest("Tracking checkpoints cannot move backwards", "CHECKPOINT_REGRESSION");
  if (checkpoint === 5 && !description?.trim() && !trackingUrl?.trim() && !riderName?.trim()) throw AppError.badRequest("Add rider details or a tracking link for the delivery checkpoint", "DELIVERY_DETAILS_REQUIRED");
  const event = await prisma.trackingEvent.upsert({
    where: { vendorOrderId_checkpoint: { vendorOrderId, checkpoint } },
    create: { vendorOrderId, checkpoint, title: definition.title, description: description?.trim() || null, avatar: avatar || "package", trackingUrl: trackingUrl?.trim() || null, riderName: riderName?.trim() || null, riderPhone: riderPhone?.trim() || null },
    update: { description: description?.trim() || null, avatar: avatar || "package", trackingUrl: trackingUrl?.trim() || null, riderName: riderName?.trim() || null, riderPhone: riderPhone?.trim() || null },
  });
  const updated = await prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: checkpointToStatus(checkpoint) }, include: { trackingEvents: { orderBy: { checkpoint: "asc" } } } });
  return { order: updated, event };
}
