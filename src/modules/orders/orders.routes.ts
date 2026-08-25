import { Router } from "express";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as ordersController from "./orders.controller";

export const ordersRouter = Router();

// Note: the webhook route is mounted separately in app.ts, BEFORE the
// express.json() body parser, because Paystack signature verification
// needs the raw request bytes — see app.ts for why.

ordersRouter.post("/checkout", requireAuth, requireRole("CUSTOMER"), ordersController.checkout);
ordersRouter.get("/verify/:reference", requireAuth, ordersController.verifyPayment);
ordersRouter.get("/me", requireAuth, requireRole("CUSTOMER"), ordersController.myOrders);
ordersRouter.get("/vendor/me", requireAuth, requireRole("VENDOR"), ordersController.myVendorOrders);
ordersRouter.patch(
  "/vendor/:id/status",
  requireAuth,
  requireRole("VENDOR"),
  ordersController.updateVendorOrderStatus
);
ordersRouter.get("/:orderNumber", requireAuth, ordersController.getByNumber);

// --- Admin ---------------------------------------------------------------
ordersRouter.get("/admin/list", requireAuth, requireRole("ADMIN"), ordersController.adminListOrders);
ordersRouter.post("/admin/:orderId/refund", requireAuth, requireRole("ADMIN"), ordersController.refundOrder);
