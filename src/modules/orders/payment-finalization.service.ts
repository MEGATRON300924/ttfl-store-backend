import { prisma } from "@/lib/prisma";
import { verifyTransaction } from "@/lib/paystack";
import { releaseForOrder, consumeForOrder } from "@/modules/flash-deals/flash-deals.service";
import { recordPurchase } from "@/modules/rewards/rewards.service";
import { recordConversionEvent } from "@/modules/ads/ads.service";
import { sendEmail, orderConfirmationEmail, orderPaymentFailedEmail, vendorNewOrderEmail, adminNewOrderEmail } from "@/lib/email";
import { sendWhatsAppNotification, newOrderWhatsAppMessage } from "@/lib/whatsapp-notifications";
import { logger } from "@/lib/logger";
import { env } from "@/config/env";
import { AppError } from "@/utils/app-error";
import type { Prisma } from "@prisma/client";

const PENDING_VENDOR_STATUSES = new Set(["PENDING"]);

export async function verifyAndFinalizePaymentSafely(reference: string) {
  const initialOrder = await prisma.order.findUnique({
    where: { paymentReference: reference },
    include: { vendorOrders: { include: { items: true } } }
  });
  if (!initialOrder) throw AppError.notFound("Order not found for this payment reference");

  const paymentWasAlreadyPaid = initialOrder.paymentStatus === "PAID";
  const verification = await verifyTransaction(reference);
  if (["ongoing", "pending", "processing", "queued"].includes(verification.status)) return initialOrder;

  if (verification.status !== "success") {
    if (initialOrder.paymentStatus !== "PAID") {
      await releaseForOrder(initialOrder.id, "FAILED");
      await prisma.$transaction([
        prisma.payment.upsert({
          where: { reference },
          create: { orderId: initialOrder.id, reference, amount: initialOrder.totalAmount, status: "FAILED", gatewayResponse: verification as unknown as Prisma.InputJsonValue },
          update: { status: "FAILED", gatewayResponse: verification as unknown as Prisma.InputJsonValue }
        }),
        prisma.order.update({ where: { id: initialOrder.id }, data: { paymentStatus: "FAILED" } })
      ]);
      const customer = await prisma.user.findUnique({ where: { id: initialOrder.customerId }, select: { email: true } });
      if (customer) void sendEmail({ to: customer.email, ...orderPaymentFailedEmail(initialOrder.orderNumber) });
    }
    throw AppError.badRequest("Payment was not successful", "PAYMENT_FAILED");
  }

  if (verification.currency !== "NGN") throw AppError.badRequest("Payment currency does not match this order", "CURRENCY_MISMATCH");

  const requestedAmountKobo = verification.requested_amount ?? verification.amount;
  const requestedAmountNaira = requestedAmountKobo / 100;
  if (Math.round(requestedAmountNaira * 100) !== Math.round(Number(initialOrder.totalAmount) * 100)) throw AppError.badRequest("Payment amount does not match order total", "AMOUNT_MISMATCH");

  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference}))`;
    const current = await tx.order.findUnique({ where: { id: initialOrder.id }, select: { paymentStatus: true } });
    if (current?.paymentStatus === "PAID") return;
    await tx.payment.upsert({
      where: { reference },
      create: { orderId: initialOrder.id, reference, amount: requestedAmountNaira, status: "PAID", channel: verification.channel, gatewayResponse: verification as unknown as Prisma.InputJsonValue },
      update: { status: "PAID", amount: requestedAmountNaira, channel: verification.channel, gatewayResponse: verification as unknown as Prisma.InputJsonValue }
    });
    await tx.order.update({ where: { id: initialOrder.id }, data: { paymentStatus: "PAID", paidAt: new Date() } });
  });

  const order = await prisma.order.findUniqueOrThrow({ where: { id: initialOrder.id }, include: { vendorOrders: { include: { items: true } } } });

  const needsFulfillment = order.vendorOrders.some(vo => PENDING_VENDOR_STATUSES.has(vo.status));
  if (needsFulfillment) {
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference}))`;
        const current = await tx.order.findUnique({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });
        if (!current) throw AppError.notFound("Order not found for this payment reference");
        if (current.paymentStatus !== "PAID") throw AppError.internal("Paid transaction lost its order payment state", "PAYMENT_STATE_ERROR");

        for (const vo of current.vendorOrders) {
          if (vo.status !== "PENDING") continue;
          for (const item of vo.items) {
            const updated = await tx.product.updateMany({ where: { id: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
            if (updated.count !== 1) throw AppError.badRequest(`Not enough stock for "${item.productName}"`, "INSUFFICIENT_STOCK");
          }
          await tx.vendorOrder.update({ where: { id: vo.id }, data: { status: "PROCESSING" } });
        }

        await consumeForOrder(tx, order.id);
        for (const item of current.vendorOrders.flatMap(vo => vo.items)) {
          await tx.$executeRawUnsafe(`UPDATE flash_deals fd SET sold_count=(SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi JOIN vendor_orders vo ON vo.id=oi.vendor_order_id JOIN orders o ON o.id=vo.order_id WHERE oi.product_id=fd.product_id AND o.payment_status='PAID') WHERE fd.product_id=$1 AND fd.active=true`, item.productId);
        }
      });
    } catch (error) {
      logger.error("Paystack payment recorded but TTFL order fulfillment failed; retry is safe", { reference, orderId: order.id, error });
      return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });
    }
  }

  const metadata = (verification as any)?.metadata;
  const adCampaignId = typeof metadata?.adCampaignId === "string" ? metadata.adCampaignId : undefined;
  if (adCampaignId && !paymentWasAlreadyPaid) void recordConversionEvent(adCampaignId, "PURCHASE", { orderId: order.id, orderNumber: order.orderNumber, amount: Number(order.totalAmount), stage: "PAID" }).catch(() => undefined);

  // Webhook + callback reconciliation can legitimately verify the same payment
  // more than once. Only the first successful finalization sends transactional
  // emails/rewards/WhatsApp so customers never receive duplicate confirmations.
  if (!paymentWasAlreadyPaid) {
    const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
    if (customer) {
      void sendEmail({ to: customer.email, ...orderConfirmationEmail(order.orderNumber) });
      void recordPurchase(customer.id, order.id, Number(order.totalAmount)).catch(() => undefined);
    }
    for (const vo of order.vendorOrders) {
      const vendor = await prisma.vendorProfile.findUnique({ where: { id: vo.vendorId }, include: { user: true } });
      if (vendor) {
        const itemCount = vo.items.reduce((sum, item) => sum + item.quantity, 0);
        void sendEmail({ to: vendor.user.email, ...vendorNewOrderEmail(order.orderNumber, itemCount) });
      }
    }
    if (env.adminNotificationEmail) void sendEmail({ to: env.adminNotificationEmail, ...adminNewOrderEmail(order.orderNumber, Number(order.totalAmount)) });
    if (env.whatsapp.adminNumber) void sendWhatsAppNotification({ to: env.whatsapp.adminNumber, message: newOrderWhatsAppMessage(order.orderNumber, Number(order.totalAmount)), event: "admin_new_order" });
  }

  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { vendorOrders: { include: { items: true } } } });
}
