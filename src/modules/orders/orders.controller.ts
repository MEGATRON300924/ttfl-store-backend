import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { AppError } from "@/utils/app-error";
import { isValidPaystackSignature } from "@/lib/paystack";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import * as ordersService from "./orders.service";
import * as vendorStaffOrderAccess from "@/modules/vendor-staff/vendor-staff-access.service";
import { checkoutSchema, updateVendorOrderStatusSchema } from "./orders.validators";
import { sendWhatsAppTemplate } from "@/lib/whatsapp-notifications";
import { createPublicTrackingToken, trackByPublicToken } from "@/modules/tracking/tracking.service";
import { env } from "@/config/env";

async function notifyCustomerWhatsAppIfNewlyPaid(reference: string, paymentWasAlreadyPaid: boolean) {
  if (paymentWasAlreadyPaid) return;
  const order = await prisma.order.findUnique({ where: { paymentReference: reference }, select: { paymentStatus: true, orderNumber: true, totalAmount: true, deliveryPhone: true } });
  if (!order || order.paymentStatus !== "PAID" || !order.deliveryPhone) return;
  const trackingToken = createPublicTrackingToken(order.orderNumber);
  const result = await sendWhatsAppTemplate({
    to: order.deliveryPhone,
    templateName: env.whatsapp.templates.orderConfirmation,
    bodyParameters: [order.orderNumber, `₦${Number(order.totalAmount).toLocaleString()}`],
    buttonUrlParameters: [trackingToken],
    event: "customer_order_paid",
  });
  if (!result.delivered) logger.error("Customer WhatsApp order confirmation template was not delivered", { reference, error: result.error, status: result.status });
}

export const checkout = asyncHandler(async (req: Request, res: Response) => { const input = checkoutSchema.parse(req.body); const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }); const { order, checkoutUrl } = await ordersService.checkout(req.user!.sub, user.email, input); res.status(201).json({ order, checkoutUrl }); });
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => { const existing = await prisma.order.findUnique({ where: { paymentReference: req.params.reference }, select: { paymentStatus: true } }); if (!existing) throw AppError.notFound("Order not found for this payment reference"); const order = await ordersService.verifyAndFinalizePayment(req.params.reference); await notifyCustomerWhatsAppIfNewlyPaid(req.params.reference, existing.paymentStatus === "PAID"); res.json({ order }); });
export const paystackWebhook = asyncHandler(async (req: Request, res: Response) => { const signature = req.headers["x-paystack-signature"] as string | undefined; const rawBody = (req as Request & { rawBody?: Buffer }).rawBody; if (!rawBody || !isValidPaystackSignature(rawBody, signature)) { logger.warn("Rejected Paystack webhook with invalid signature"); throw AppError.unauthorized("Invalid webhook signature", "INVALID_WEBHOOK_SIGNATURE"); } const event = req.body as { event: string; data: { reference: string } }; if (event.event === "charge.success") { try { const existing = await prisma.order.findUnique({ where: { paymentReference: event.data.reference }, select: { paymentStatus: true } }); await ordersService.verifyAndFinalizePayment(event.data.reference); await notifyCustomerWhatsAppIfNewlyPaid(event.data.reference, existing?.paymentStatus === "PAID"); } catch (err) { logger.error("Failed to finalize order from webhook", { err, reference: event.data.reference }); } } res.status(200).json({ received: true }); });
export const myOrders = asyncHandler(async (req: Request, res: Response) => { res.json({ orders: await ordersService.getMyOrders(req.user!.sub) }); });
export const getByNumber = asyncHandler(async (req: Request, res: Response) => { res.json({ order: await ordersService.getOrderByNumber(req.params.orderNumber, req.user!.sub, req.user!.role) }); });
export const trackPublicLink = asyncHandler(async (req: Request, res: Response) => { res.json(await trackByPublicToken(req.params.token)); });
export const myVendorOrders = asyncHandler(async (req: Request, res: Response) => { res.json({ vendorOrders: await vendorStaffOrderAccess.getVendorOrders(req.user!.sub) }); });
export const updateVendorOrderStatus = asyncHandler(async (req: Request, res: Response) => { const { status } = updateVendorOrderStatusSchema.parse(req.body); res.json({ vendorOrder: await vendorStaffOrderAccess.updateVendorOrderStatus(req.user!.sub, req.params.id, status) }); });
export const refundOrder = asyncHandler(async (req: Request, res: Response) => { res.json({ order: await ordersService.refundOrder(req.params.orderId, req.user!.sub) }); });
export const adminListOrders = asyncHandler(async (req: Request, res: Response) => { const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 50); const paymentStatus = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : undefined; res.json(await ordersService.adminListOrders(page, limit, paymentStatus)); });
