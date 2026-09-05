import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { setAuthCookies } from "@/lib/cookies";
import * as service from "./vendor-staff.service";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["MANAGER", "ORDERS", "PRODUCTS", "SUPPORT", "FINANCE"]),
});

const updateSchema = z.object({
  role: z.enum(["MANAGER", "ORDERS", "PRODUCTS", "SUPPORT", "FINANCE"]).optional(),
  active: z.boolean().optional(),
});

const acceptSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(8).max(128).optional(),
});

export const vendorStaffRouter = Router();

vendorStaffRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  res.json({ items: await service.listStaff(req.user!.sub) });
}));

vendorStaffRouter.post("/invite", requireAuth, asyncHandler(async (req, res) => {
  const input = inviteSchema.parse(req.body);
  res.status(201).json(await service.inviteStaff(req.user!.sub, input));
}));

vendorStaffRouter.patch("/:id", requireAuth, asyncHandler(async (req, res) => {
  const input = updateSchema.parse(req.body);
  res.json(await service.updateStaff(req.user!.sub, req.params.id, input));
}));

vendorStaffRouter.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  await service.removeStaff(req.user!.sub, req.params.id);
  res.status(204).send();
}));

vendorStaffRouter.get("/invitations/:token", asyncHandler(async (req, res) => {
  res.json(await service.getInvitation(req.params.token));
}));

vendorStaffRouter.post("/invitations/:token/accept", asyncHandler(async (req, res) => {
  const input = acceptSchema.parse(req.body);
  const result = await service.acceptInvitation(req.params.token, input, req.user?.sub);
  if (result.accessToken) {
    setAuthCookies(res, result.accessToken, "");
  }
  res.status(200).json({ user: result.user, staff: result.staff });
}));
