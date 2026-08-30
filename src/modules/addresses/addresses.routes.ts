import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import * as addressesService from "./addresses.service";

export const addressesRouter = Router();

addressesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const addresses = await addressesService.listAddresses(req.user!.sub);
    res.json({ addresses });
  })
);

const createSchema = z.object({
  label: z.string().min(1).max(40),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  country: z.string().min(2).max(80).optional(),
  isDefault: z.boolean().optional(),
});

addressesRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const address = await addressesService.createAddress(req.user!.sub, input);
    res.status(201).json({ address });
  })
);

const updateSchema = createSchema.partial();

addressesRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const address = await addressesService.updateAddress(req.user!.sub, req.params.id, input);
    res.json({ address });
  })
);

addressesRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await addressesService.deleteAddress(req.user!.sub, req.params.id);
    res.status(204).send();
  })
);
