import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import * as orders from "./service-orders.service";

export const serviceOrdersRouter = Router();

const createSchema = z.object({
  serviceId: z.string().min(1),
  adCampaignId: z.string().uuid().optional(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  bookingTime: z.string().trim().max(80).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

serviceOrdersRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const input = createSchema.parse(req.body);
  const customer = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { email: true } });
  if (!customer) throw AppError.notFound("Account not found");
  const result = await orders.createServiceOrder(req.user!.sub, customer.email, input.serviceId, input);
  res.status(201).json(result);
}));
serviceOrdersRouter.get("/mine", requireAuth, asyncHandler(async (req, res) => { res.json({ serviceOrders: await orders.getMyServiceOrders(req.user!.sub) }); }));
serviceOrdersRouter.get("/vendor/mine", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { res.json({ serviceOrders: await orders.getMyVendorServiceOrders(req.user!.sub) }); }));
serviceOrdersRouter.patch("/vendor/:id/status", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const input = z.object({ status: z.enum(orders.SERVICE_ORDER_STATUSES) }).parse(req.body); res.json({ serviceOrder: await orders.updateVendorServiceOrderStatus(req.user!.sub, req.params.id, input.status) }); }));
serviceOrdersRouter.get("/:id", requireAuth, asyncHandler(async (req, res) => { res.json({ serviceOrder: await orders.getServiceOrderById(req.params.id, req.user!.sub, true) }); }));
serviceOrdersRouter.post("/:reference/verify", requireAuth, asyncHandler(async (req, res) => { const serviceOrder = await orders.verifyAndFinalizeServicePayment(req.params.reference); if (serviceOrder.customer_id !== req.user!.sub) throw AppError.forbidden("You don't have access to this service order"); res.json({ serviceOrder }); }));
