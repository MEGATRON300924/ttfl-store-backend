import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { AppError } from "@/utils/app-error";
import { isValidPaystackSignature } from "@/lib/paystack";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import * as ordersService from "./orders.service";
import * as vendorStaffOrderAccess from "@/modules/vendor-staff/vendor-staff-access.service";
import { checkoutSchema, updateVendorOrderStatusSchema } from "./orders.validators";

export const checkout = asyncHandler(async (req: Request, res: Response) => { const input = checkoutSchema.parse(req.body); const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } }); const { order, checkoutUrl } = await ordersService.checkout(req.user!.sub, user.email, input); res.status(201).json({ order, checkoutUrl }); });
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => { const order = await ordersService.verifyAndFinalizePayment(req.params.reference); res.json({ order }); });
export const paystackWebhook = asyncHandler(async (req: Request, res: Response) => { const signature = req.headers["x-paystack-signature"] as string | undefined; const rawBody = (req as Request & { rawBody?: Buffer }).rawBody; if (!rawBody || !isValidPaystackSignature(rawBody, signature)) { logger.warn("Rejected Paystack webhook with invalid signature"); throw AppError.unauthorized("Invalid webhook signature", "INVALID_WEBHOOK_SIGNATURE"); } const event = req.body as { event: string; data: { reference: string } }; if (event.event === "charge.success") { try { await ordersService.verifyAndFinalizePayment(event.data.reference); } catch (err) { logger.error("Failed to finalize order from webhook", { err, reference: event.data.reference }); } } res.status(200).json({ received: true }); });
export const myOrders = asyncHandler(async (req: Request, res: Response) => { res.json({ orders: await ordersService.getMyOrders(req.user!.sub) }); });
export const getByNumber = asyncHandler(async (req: Request, res: Response) => { res.json({ order: await ordersService.getOrderByNumber(req.params.orderNumber, req.user!.sub, req.user!.role) }); });
export const myVendorOrders = asyncHandler(async (req: Request, res: Response) => { res.json({ vendorOrders: await vendorStaffOrderAccess.getVendorOrders(req.user!.sub) }); });
export const updateVendorOrderStatus = asyncHandler(async (req: Request, res: Response) => { const { status } = updateVendorOrderStatusSchema.parse(req.body); res.json({ vendorOrder: await vendorStaffOrderAccess.updateVendorOrderStatus(req.user!.sub, req.params.id, status) }); });
export const refundOrder = asyncHandler(async (req: Request, res: Response) => { res.json({ order: await ordersService.refundOrder(req.params.orderId, req.user!.sub) }); });
export const adminListOrders = asyncHandler(async (req: Request, res: Response) => { const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 50); const paymentStatus = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : undefined; res.json(await ordersService.adminListOrders(page, limit, paymentStatus)); });
