import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { refundTransaction } from "@/lib/paystack";
import { sendEmail, orderRefundedEmail } from "@/lib/email";
import { recordAudit } from "@/lib/audit";
import { reversePurchase } from "@/modules/rewards/rewards.service";
import { logger } from "@/lib/logger";

async function finalizeRefund(orderId: string, adminId?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vendorOrders: { include: { items: true } } } });
  if (!order) return null;
  if (order.paymentStatus === "REFUNDED") return order;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.paymentReference}))`;
    const current = await tx.order.findUnique({ where: { id: order.id }, select: { paymentStatus: true } });
    if (current?.paymentStatus === "REFUNDED") return;
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "REFUNDED" } });
    await tx.vendorOrder.updateMany({ where: { orderId: order.id }, data: { status: "REFUNDED" } });
    for (const vo of order.vendorOrders) for (const item of vo.items) {
      await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    }
  });

  void reversePurchase(order.id).catch((error) => logger.warn("Failed to reverse rewards after refund", { orderId: order.id, error }));
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) void sendEmail({ to: customer.email, ...orderRefundedEmail(order.orderNumber) });
  if (adminId) await recordAudit({ actorId: adminId, action: "ORDER_REFUNDED", targetType: "Order", targetId: order.id });
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });
}

export async function requestOrderRefund(orderId: string, adminId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vendorOrders: { include: { items: true } } } });
  if (!order) throw AppError.notFound("Order not found");
  if (order.paymentStatus !== "PAID") throw AppError.badRequest("Only paid orders can be refunded", "ORDER_NOT_PAID");

  const refund = await refundTransaction(order.paymentReference, Number(order.totalAmount));
  const status = String(refund.status ?? "pending").toLowerCase();

  if (status === "processed") {
    const finalized = await finalizeRefund(order.id, adminId);
    return { order: finalized, refundStatus: status };
  }

  await recordAudit({ actorId: adminId, action: "ORDER_REFUNDED", targetType: "Order", targetId: order.id, metadata: { refundRequested: true, refundStatus: status } });
  return { order, refundStatus: status };
}

export async function handlePaystackRefundEvent(event: string, data: any) {
  const reference = typeof data?.transaction_reference === "string" ? data.transaction_reference : undefined;
  if (!reference) return false;
  const order = await prisma.order.findUnique({ where: { paymentReference: reference }, select: { id: true, paymentStatus: true } });
  if (!order) return false;

  if (event === "refund.processed") {
    await finalizeRefund(order.id);
    return true;
  }

  if (event === "refund.failed") {
    logger.warn("Paystack refund failed; merchant balance was credited", { reference, refundStatus: data?.status });
    return true;
  }

  if (["refund.pending", "refund.processing", "refund.needs-attention"].includes(event)) return true;
  return false;
}
