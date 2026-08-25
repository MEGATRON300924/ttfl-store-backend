import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as productsController from "./products.controller";

export const productsRouter = Router();

// --- Public ---------------------------------------------------------------
productsRouter.get("/", productsController.search);
productsRouter.get("/:slug", productsController.getBySlug);
productsRouter.post("/by-id/:id/referral", productsController.referral);

// --- Vendor -----------------------------------------------------------------
productsRouter.get(
  "/me/list",
  requireAuth,
  requireRole("VENDOR"),
  productsController.listMine
);
productsRouter.post(
  "/",
  requireAuth,
  requireRole("VENDOR"),
  productsController.create
);
productsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("VENDOR"),
  productsController.update
);
productsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("VENDOR"),
  productsController.remove
);

// --- Admin moderation -------------------------------------------------------
productsRouter.get(
  "/admin/list",
  requireAuth,
  requireRole("ADMIN"),
  productsController.adminList
);
productsRouter.post(
  "/:id/suspend",
  requireAuth,
  requireRole("ADMIN"),
  productsController.suspend
);
productsRouter.post(
  "/:id/reinstate",
  requireAuth,
  requireRole("ADMIN"),
  productsController.reinstate
);
