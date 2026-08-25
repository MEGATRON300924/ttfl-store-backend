import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { detectDeviceType } from "@/utils/device-detect";
import * as productsService from "./products.service";
import {
  createProductSchema,
  updateProductSchema,
  productSearchSchema,
  referralEventSchema,
} from "./products.validators";

function requestMeta(req: Request) {
  const userAgent = req.headers["user-agent"];
  return { userAgent, ipAddress: req.ip, deviceType: detectDeviceType(userAgent) };
}

export const search = asyncHandler(async (req: Request, res: Response) => {
  const params = productSearchSchema.parse(req.query);
  const result = await productsService.searchProducts(params);
  res.json(result);
});

export const getBySlug = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductBySlug(req.params.slug);
  res.json({ product });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = createProductSchema.parse(req.body);
  const product = await productsService.createProduct(req.user!.sub, input);
  res.status(201).json({ product });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const input = updateProductSchema.parse(req.body);
  const product = await productsService.updateProduct(req.user!.sub, req.params.id, input as any);
  res.json({ product });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteProduct(req.user!.sub, req.params.id);
  res.status(204).send();
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const products = await productsService.listMyProducts(req.user!.sub);
  res.json({ products });
});

// Spec §14/§15 — client calls this right before opening the external link
// or WhatsApp chat, gets back the destination to redirect to, and the click
// is already durably recorded server-side by the time the response returns.
export const referral = asyncHandler(async (req: Request, res: Response) => {
  const body = referralEventSchema.parse(req.body ?? {});
  const { destination } = await productsService.recordReferralAndGetDestination(req.params.id, {
    ...body,
    ...requestMeta(req),
  });
  res.json({ destination });
});

export const adminList = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 24);
  const result = await productsService.adminListProducts({ q, page, limit });
  res.json(result);
});

export const suspend = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.suspendProduct(req.params.id, req.user!.sub, req.ip);
  res.json({ product });
});

export const reinstate = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.reinstateProduct(req.params.id, req.user!.sub, req.ip);
  res.json({ product });
});
