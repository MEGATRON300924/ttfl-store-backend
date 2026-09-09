import { Router } from "express";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as controller from "./rewards.controller";

export const rewardsRouter = Router();
rewardsRouter.get("/me", requireAuth, requireRole("CUSTOMER"), controller.me);
rewardsRouter.post("/redeem", requireAuth, requireRole("CUSTOMER"), controller.redeem);
rewardsRouter.get("/admin/settings", requireAuth, requireRole("ADMIN"), controller.adminSettings);
rewardsRouter.patch("/admin/settings", requireAuth, requireRole("ADMIN"), controller.updateAdminSettings);
