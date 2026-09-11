import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { AppError } from "@/utils/app-error";
import { isValidPaystackSignature, verifyTransaction } from "@/lib/paystack";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/modules/notifications/notifications.service";
import * as ordersService from "./orders.service";
import * as vendorStaffOrderAccess from "@/modules/vendor-staff/vendor-staff-access.service";
import { checkoutSchema, updateVendorOrderStatusSchema } from "./orders.validators";
import { sendWhatsAppTemplate } from "@/lib/whatsapp-notifications";
import { createPublicTrackingToken, trackByPublicToken, getDriverContactByToken } from "../tracking/tracking.service";
import { env } from "@/config/env";

async function notifyCustomerWhatsAppIfNewlyPaid(reference: string, paymentWasAlreadyPaid: boolean) {
  if (paymentWasAlreadyPaid) return;
  const order = await prisma.order.findUnique({ where: { paymentReference: reference }, select: { paymentStatus: true, orderNumber: true, totalAmount: true, deliveryPhone: true } });
  if (!order || order.paymentStatus !== "PAID" || !order.deliveryPhone) return;
  const trackingToken = createPublicTrackingToken(order.orderNumber);
  const result = await sendWhatsAppTemplate({ to: order.deliveryPhone, templateName: env.whatsapp.templates.orderConfirmation, bodyParameters: [order.orderNumber, `₦${Number(order.totalAmount).toLocaleString()}`], buttonUrlParameters: [trackingToken], event: "customer_order_paid" });
  if (!result.delivered) logger.error("Customer WhatsApp order confirmation template was not delivered", { reference, error: result.error, status: result.status });
}

async function notifyCustomerPushIfNewlyPaid(reference: string, paymentWasAlreadyPaid: boolean) {
  if (paymentWasAlreadyPaid) return;
  try {
    const order = await prisma.order.findUnique({ where: { paymentReference: reference }, select: { customerId: true, paymentStatus: true, orderNumber: true } });
    if (!order || order.paymentStatus !== "PAID") return;
    await sendPushToUser(order.customerId, {
      title: "Payment confirmed",
      body: `Payment for order ${order.orderNumber} has been confirmed.`,
      data: { type: "order.payment.confirmed", orderNumber: order.orderNumber, url: `${env.appUrl}/orders/${encodeURIComponent(order.orderNumber)}` },
    });
  } catch (error) {
    logger.warn("Customer push notification after payment confirmation failed", { reference, error });
  }
}

async function notifyPostPayment(reference: string, paymentWasAlreadyPaid: boolean) {
  try {
    await notifyCustomerWhatsAppIfNewlyPaid(reference, paymentWasAlreadyPaid);
  } catch (error) {
    logger.warn("Customer WhatsApp notification after payment confirmation failed", { reference, error });
  }
  try {
    await notifyCustomerPushIfNewlyPaid(reference, paymentWasAlreadyPaid);
  } catch (error) {
    logger.warn("Customer push notification after payment confirmation failed", { reference, error });
  }
}

export const checkout = asyncHandler(async (req: Request, res: Response) => { const input = checkoutSchema.parse(req.body); const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }); const { order, checkoutUrl } = await ordersService.checkout(req.user!.sub, user.email, input); res.status(201).json({ order, checkoutUrl }); });

// Fast customer-facing payment check. This asks Paystack directly for the current
// transaction state and does not wait for order fulfillment, stock, flash-deal SQL,
// notifications, or other post-payment work to finish.
export const paymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const reference = req.params.reference;
  const order = await prisma.order.findUnique({ where: { paymentReference: reference }, select: { orderNumber: true, totalAmount: true, paymentStatus: true } });
  if (!order) throw AppError.notFound("Order not found for this payment reference");

  const verification = await verifyTransaction(reference);
  const requestedAmountKobo = verification.requested_amount ?? verification.amount;
  const requestedAmountNaira = requestedAmountKobo / 100;
  const amountMatches = Math.round(requestedAmountNaira * 100) === Math.round(Number(order.totalAmount) * 100);
  const currencyMatches = verification.currency === "NGN";

  if (verification.status === "success" && !amountMatches) {
    throw AppError.badRequest("Payment amount does not match order total", "AMOUNT_MISMATCH");
  }
  if (verification.status === "success" && !currencyMatches) {
    throw AppError.badRequest("Payment currency does not match this order", "CURRENCY_MISMATCH");
  }

  res.json({
    reference,
    orderNumber: order.orderNumber,
    paymentStatus: verification.status === "success" && amountMatches && currencyMatches ? "PAID" : order.paymentStatus,
    orderFinalized: order.paymentStatus === "PAID",
    gatewayStatus: verification.status,
    gatewayResponse: verification.gateway_response,
  });
});

export const verifyPayment = asyncHandler(async (req: Request, res: Response) => { const existing = await prisma.order.findUnique({ where: { paymentReference: req.params.reference }, select: { paymentStatus: true } }); if (!existing) throw AppError.notFound("Order not found for this payment reference"); const order = await ordersService.verifyAndFinalizePayment(req.params.reference); void notifyPostPayment(req.params.reference, existing.paymentStatus === "PAID"); res.json({ order }); });
export const paystackWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !isValidPaystackSignature(rawBody, signature)) {
    logger.warn("Rejected Paystack webhook with invalid signature");
    throw AppError.unauthorized("Invalid webhook signature", "INVALID_WEBHOOK_SIGNATURE");
  }

  const event = req.body as { event: string; data: { reference: string } };
  res.status(200).json({ received: true });

  if (event.event === "charge.success") {
    void (async () => {
      try {
        const existing = await prisma.order.findUnique({ where: { paymentReference: event.data.reference }, select: { paymentStatus: true } });
        await ordersService.verifyAndFinalizePayment(event.data.reference);
        await notifyPostPayment(event.data.reference, existing?.paymentStatus === "PAID");
      } catch (err) {
        logger.error("Failed to finalize order from webhook", { err, reference: event.data.reference });
      }
    })();
  }
});
export const myOrders = asyncHandler(async (req: Request, res: Response) => { res.json({ orders: await ordersService.getMyOrders(req.user!.sub) }); });
export const getByNumber = asyncHandler(async (req: Request, res: Response) => { res.json({ order: await ordersService.getOrderByNumber(req.params.orderNumber, req.user!.sub, req.user!.role) }); });
export const trackPublicLink = asyncHandler(async (req: Request, res: Response) => { res.json(await trackByPublicToken(req.params.token)); });
export const driverContact = asyncHandler(async (req: Request, res: Response) => { const contact = await getDriverContactByToken(req.params.token); res.json({ contact }); });
export const myVendorOrders = asyncHandler(async (req: Request, res: Response) => { res.json({ vendorOrders: await vendorStaffOrderAccess.getVendorOrders(req.user!.sub) }); });
export const updateVendorOrderStatus = asyncHandler(async (req: Request, res: Response) => { const { status } = updateVendorOrderStatusSchema.parse(req.body); res.json({ vendorOrder: await vendorStaffOrderAccess.updateVendorOrderStatus(req.user!.sub, req.params.id, status) }); });
export const refundOrder = asyncHandler(async (req: Request, res: Response) => { res.json({ order: await ordersService.refundOrder(req.params.orderId, req.user!.sub) }); });
export const adminListOrders = asyncHandler(async (req: Request, res: Response) => { const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 50); const paymentStatus = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : undefined; res.json(await ordersService.adminListOrders(page, limit, paymentStatus)); });
