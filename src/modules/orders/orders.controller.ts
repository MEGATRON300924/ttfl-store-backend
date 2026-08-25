import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { AppError } from "@/utils/app-error";
import { isValidPaystackSignature } from "@/lib/paystack";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import * as ordersService from "./orders.service";
import { checkoutSchema, updateVendorOrderStatusSchema } from "./orders.validators";

export const checkout = asyncHandler(async (req: Request, res: Response) => {
  const input = checkoutSchema.parse(req.body);
  // req.user carries the JWT claims only (no email) — fetch it fresh so a
  // stale token can't be used to checkout under an old email.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });

  const { order, checkoutUrl } = await ordersService.checkout(req.user!.sub, user.email, input);
  res.status(201).json({ order, checkoutUrl });
});

// Fallback for the customer's browser landing back on the callback URL —
// the webhook is the source of truth, this just lets the frontend show an
// immediate result instead of waiting on webhook delivery.
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const { reference } = req.params;
  const order = await ordersService.verifyAndFinalizePayment(reference);
  res.json({ order });
});

// Paystack calls this directly — must verify the HMAC signature against
// the RAW request body before trusting anything in it (spec §20).
export const paystackWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody || !isValidPaystackSignature(rawBody, signature)) {
    logger.warn("Rejected Paystack webhook with invalid signature");
    throw AppError.unauthorized("Invalid webhook signature", "INVALID_WEBHOOK_SIGNATURE");
  }

  const event = req.body as { event: string; data: { reference: string } };

  // Always respond 200 quickly so Paystack doesn't retry-storm us; do the
  // actual work inline since it's fast, but never let a processing error
  // here surface as a webhook failure once we've accepted the payload.
  if (event.event === "charge.success") {
    try {
      await ordersService.verifyAndFinalizePayment(event.data.reference);
    } catch (err) {
      logger.error("Failed to finalize order from webhook", { err, reference: event.data.reference });
    }
  }

  res.status(200).json({ received: true });
});

export const myOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await ordersService.getMyOrders(req.user!.sub);
  res.json({ orders });
});

export const getByNumber = asyncHandler(async (req: Request, res: Response) => {
  const order = await ordersService.getOrderByNumber(
    req.params.orderNumber,
    req.user!.sub,
    req.user!.role
  );
  res.json({ order });
});

export const myVendorOrders = asyncHandler(async (req: Request, res: Response) => {
  const vendorOrders = await ordersService.getMyVendorOrders(req.user!.sub);
  res.json({ vendorOrders });
});

export const updateVendorOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = updateVendorOrderStatusSchema.parse(req.body);
  const vendorOrder = await ordersService.updateVendorOrderStatus(
    req.user!.sub,
    req.params.id,
    status
  );
  res.json({ vendorOrder });
});

export const refundOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await ordersService.refundOrder(req.params.orderId, req.user!.sub);
  res.json({ order });
});

export const adminListOrders = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const paymentStatus = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : undefined;
  const result = await ordersService.adminListOrders(page, limit, paymentStatus);
  res.json(result);
});
