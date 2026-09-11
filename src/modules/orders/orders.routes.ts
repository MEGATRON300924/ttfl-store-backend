import { Router } from "express";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as ordersController from "./orders.controller";

export const ordersRouter = Router();

// The Paystack webhook is mounted separately in app.ts before express.json().
ordersRouter.post("/checkout", requireAuth, requireRole("CUSTOMER"), ordersController.checkout);
// Paystack redirects the customer here after checkout. This endpoint must be public
// because a payment callback is not an authenticated application request.
ordersRouter.get("/verify/:reference", ordersController.verifyPayment);
ordersRouter.get("/track-link/:token", ordersController.trackPublicLink);
ordersRouter.get("/driver-contact/:token", ordersController.driverContact);
ordersRouter.get("/me", requireAuth, requireRole("CUSTOMER"), ordersController.myOrders);
ordersRouter.get("/vendor/me", requireAuth, requireRole("VENDOR"), ordersController.myVendorOrders);
ordersRouter.patch("/vendor/:id/status", requireAuth, requireRole("VENDOR"), ordersController.updateVendorOrderStatus);

// Static admin routes must be registered before /:orderNumber.
ordersRouter.get("/admin/list", requireAuth, requireRole("ADMIN"), ordersController.adminListOrders);
ordersRouter.post("/admin/:orderId/refund", requireAuth, requireRole("ADMIN"), ordersController.refundOrder);

ordersRouter.get("/:orderNumber", requireAuth, ordersController.getByNumber);
