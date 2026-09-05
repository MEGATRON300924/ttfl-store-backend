import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { AppError } from "@/utils/app-error";
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

export async function updateVendorOrderStatus(userId: string, vendorOrderId: string, nextStatus: OrderStatus) {
  const vendor = await getVendorProfileForUser(userId);
  const vendorOrder = await prisma.vendorOrder.findUnique({ where: { id: vendorOrderId } });
  if (!vendorOrder || vendorOrder.vendorId !== vendor.id) throw AppError.notFound("Order not found");
  const allowed = FORWARD_TRANSITIONS[vendorOrder.status as OrderStatus];
  if (!allowed.includes(nextStatus)) throw AppError.badRequest(`Can't move an order from ${vendorOrder.status} to ${nextStatus}`, "INVALID_STATUS_TRANSITION");
  return prisma.vendorOrder.update({ where: { id: vendorOrderId }, data: { status: nextStatus } });
}
