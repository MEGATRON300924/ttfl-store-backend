import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { z } from "zod";
import * as rewards from "./rewards.service";

const redeemSchema = z.object({ points: z.number().int().positive().max(1_000_000), kind: z.enum(["ORDER_DISCOUNT", "DELIVERY_DISCOUNT"]), referenceId: z.string().max(100).optional() });
const settingsSchema = z.record(z.number().finite().nonnegative());

export const me = asyncHandler(async (req: Request, res: Response) => { res.json({ wallet: await rewards.getWallet(req.user!.sub), history: await rewards.getHistory(req.user!.sub) }); });
export const redeem = asyncHandler(async (req: Request, res: Response) => { res.json({ redemption: await rewards.redeem(req.user!.sub, redeemSchema.parse(req.body).points, redeemSchema.parse(req.body).kind, redeemSchema.parse(req.body).referenceId) }); });
export const adminSettings = asyncHandler(async (_req: Request, res: Response) => { res.json({ settings: await rewards.getSettings() }); });
export const updateAdminSettings = asyncHandler(async (req: Request, res: Response) => { res.json({ settings: await rewards.updateSettings(settingsSchema.parse(req.body)) }); });
