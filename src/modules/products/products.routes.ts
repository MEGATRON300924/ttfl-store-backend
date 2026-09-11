import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as productsController from "./products.controller";

export const productsRouter = Router();

productsRouter.get("/", productsController.search);
productsRouter.get("/me/list", requireAuth, requireRole("VENDOR"), productsController.listMine);
productsRouter.get("/me/sponsored", requireAuth, requireRole("VENDOR"), productsController.listMySponsored);
productsRouter.post("/", requireAuth, requireRole("VENDOR"), productsController.create);
productsRouter.patch("/:id/sponsored", requireAuth, requireRole("VENDOR"), productsController.setSponsored);
productsRouter.post("/:id/availability-notifications", productsController.notifyAvailability);
productsRouter.post("/:id/videos", requireAuth, requireRole("VENDOR"), productsController.replaceVideos);
productsRouter.get("/:slug", productsController.getBySlug);
productsRouter.post("/by-id/:id/referral", productsController.referral);
productsRouter.patch("/:id", requireAuth, requireRole("VENDOR"), productsController.update);
productsRouter.delete("/:id", requireAuth, requireRole("VENDOR"), productsController.remove);

productsRouter.get("/admin/list", requireAuth, requireRole("ADMIN"), productsController.adminList);
productsRouter.post("/:id/suspend", requireAuth, requireRole("ADMIN"), productsController.suspend);
productsRouter.post("/:id/reinstate", requireAuth, requireRole("ADMIN"), productsController.reinstate);
