import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { AppError } from "@/utils/app-error";
import { env } from "@/config/env";
import { sendWhatsAppTemplate, emitMaxEvent } from "@/lib/whatsapp-notifications";
import { createPublicTrackingToken, createDriverContactToken } from "../tracking/tracking.service";
import { sendPushToUser } from "../notifications/notifications.service";
import type { OrderStatus } from "@prisma/client";

const FORWARD_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [], CANCELLED: [], REFUND_REQUESTED: ["REFUNDED"], REFUNDED: [], FAILED: [],
};

export async function getVendorOrders(userId: string) {
  const vendor = await getVendorProfileForUser(userId);
  return prisma.vendorOrder.findMany({ where: { vendorId: vendor.id }, include: { items: true, order: true }, orderBy: { createdAt: "desc" } });
}

async function notifyCustomerOrderStatus(vendorOrderId: string, status: OrderStatus, storeName: string, storeSlug: string) {
  if (!["PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(status)) return;

  const vendorOrder = await prisma.vendorOrder.findUnique({
    where: { id: vendorOrderId },
    include: { order: { select: { orderNumber: true, deliveryPhone: true, customerId: true, customer: true } }, trackingEvents: { where: { checkpoint: 5 }, take: 1 } },
  });
  if (!vendorOrder) return;

  const customer = vendorOrder.order.customer;
  const firstName = customer?.firstName || "there";
  const orderNumber = vendorOrder.order.orderNumber;
  const trackingToken = createPublicTrackingToken(orderNumber);

  const pushCopy: Record<string, { title: string; body: string }> = {
    PROCESSING: { title: "Your TTFL order is being prepared", body: `${storeName} is processing order ${orderNumber}.` },
    SHIPPED: { title: "Your TTFL order has shipped", body: `Order ${orderNumber} from ${storeName} is on its way.` },
    OUT_FOR_DELIVERY: { title: "Your TTFL order is out for delivery", body: `Order ${orderNumber} from ${storeName} is on the way to you.` },
    DELIVERED: { title: "Your TTFL order was delivered", body: `Order ${orderNumber} from ${storeName} has been delivered.` },
    CANCELLED: { title: "Your TTFL order was cancelled", body: `Order ${orderNumber} from ${storeName} has been cancelled.` },
  };
  const push = pushCopy[status];
  if (vendorOrder.order.customerId && push) {
    await sendPushToUser(vendorOrder.order.customerId, {
      title: push.title,
      body: push.body,
      data: { url: `/orders/${encodeURIComponent(orderNumber)}`, type: `order_${status.toLowerCase()}`, orderNumber },
    });
  }

  if (!vendorOrder.order.deliveryPhone) return;

  const templateByStatus: Partial<Record<OrderStatus, string>> = {
    PROCESSING: env.whatsapp.templates.orderProcessing,
    SHIPPED: env.whatsapp.templates.orderShipped,
    OUT_FOR_DELIVERY: env.whatsapp.templates.orderOutForDelivery,
    DELIVERED: env.whatsapp.templates.orderDelivered,
    CANCELLED: env.whatsapp.templates.orderCancelled,
  };
  const templateName = templateByStatus[status];
  if (!templateName) return;

  const bodyParameters = [firstName, orderNumber, storeName];
  let buttonUrlParameters: string[] = [trackingToken];
  if (status === "OUT_FOR_DELIVERY") {
    buttonUrlParameters = [createDriverContactToken(vendorOrderId)];
  } else if (status === "DELIVERED") {
    buttonUrlParameters = [storeSlug];
  }

  const result = await sendWhatsAppTemplate({
    to: vendorOrder.order.deliveryPhone,
    templateName,
    bodyParameters,
    buttonUrlParameters,
    event: `order_${status.toLowerCase()}`,
  });

  await emitMaxEvent({
    event: "whatsapp.notification.sent",
    source: "ttfl-store",
    notificationType: status,
    customerId: vendorOrder.order.customerId,
    orderNumber,
    storeSlug,
    templateName,
    status: result.delivered ? "SENT" : "FAILED",
    providerMessageId: result.messageId ?? null,
    error: result.error ?? null,
    sentAt: new Date().toISOString(),
  });
}

export async function updateVendorOrderStatus(userId: string, vendorOrderId: string, nextStatus: OrderStatus) {
  const vendor = await getVendorProfileForUser(userId);
  const vendorOrder = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId } });
  if (!vendorOrder || vendorOrder.vendorId !== vendor.id) throw AppError.notFound("Order not found");
  const allowed = FORWARD_TRANSITIONS[vendorOrder.status as OrderStatus];
  if (!allowed.includes(nextStatus)) throw AppError.badRequest(`Can't move an order from ${vendorOrder.status} to ${nextStatus}`, "INVALID_STATUS_TRANSITION");

  const updated = await prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: nextStatus } });
  void notifyCustomerOrderStatus(vendorOrderId, nextStatus, vendor.storeName, vendor.storeSlug).catch(() => undefined);
  return updated;
}
