import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { detectDeviceType } from "@/utils/device-detect";
import * as productsService from "./products.service";
import { createProductSchema, updateProductSchema, productSearchSchema, referralEventSchema, availabilityNotificationSchema } from "./products.validators";
import { subscribe as subscribeAvailability } from "./product-availability.service";
import { replaceProductVideos } from "./product-media.service";
import { z } from "zod";

function requestMeta(req: Request) { const userAgent = req.headers["user-agent"]; return { userAgent, ipAddress: req.ip, deviceType: detectDeviceType(userAgent) }; }
export const search = asyncHandler(async (req: Request, res: Response) => { const params = productSearchSchema.parse(req.query); res.json(await productsService.searchProducts(params)); });
export const getBySlug = asyncHandler(async (req: Request, res: Response) => { const product = await productsService.getProductBySlug(req.params.slug); res.json({ product }); });
export const create = asyncHandler(async (req: Request, res: Response) => { const product = await productsService.createProduct(req.user!.sub, createProductSchema.parse(req.body)); res.status(201).json({ product }); });
export const update = asyncHandler(async (req: Request, res: Response) => { const product = await productsService.updateProduct(req.user!.sub, req.params.id, updateProductSchema.parse(req.body) as any); res.json({ product }); });
export const replaceVideos = asyncHandler(async (req: Request, res: Response) => { const videos = z.object({ videos: z.array(z.string().url()).max(3) }).parse(req.body ?? {}).videos; res.json({ videos: await replaceProductVideos(req.user!.sub, req.params.id, videos) }); });
export const remove = asyncHandler(async (req: Request, res: Response) => { await productsService.deleteProduct(req.user!.sub, req.params.id); res.status(204).send(); });
export const listMine = asyncHandler(async (req: Request, res: Response) => { res.json({ products: await productsService.listMyProducts(req.user!.sub) }); });
export const listMySponsored = asyncHandler(async (req: Request, res: Response) => { res.json({ products: await productsService.listMySponsoredProducts(req.user!.sub) }); });
export const setSponsored = asyncHandler(async (req: Request, res: Response) => { res.json({ product: await productsService.setProductSponsored(req.user!.sub, req.params.id, Boolean(req.body?.sponsored)) }); });
export const referral = asyncHandler(async (req: Request, res: Response) => { const body = referralEventSchema.parse(req.body); const { destination } = await productsService.recordReferralAndGetDestination(req.params.id, { ...body, ...requestMeta(req) }); res.json({ destination }); });
export const notifyAvailability = asyncHandler(async (req: Request, res: Response) => { const input = availabilityNotificationSchema.parse(req.body ?? {}); res.status(201).json(await subscribeAvailability(req.params.id, req.user?.sub, input)); });
export const adminList = asyncHandler(async (req: Request, res: Response) => { const q = typeof req.query.q === "string" ? req.query.q : undefined; const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 24); res.json(await productsService.adminListProducts({ q, page, limit })); });
export const suspend = asyncHandler(async (req: Request, res: Response) => { res.json({ product: await productsService.suspendProduct(req.params.id, req.user!.sub, req.ip) }); });
export const reinstate = asyncHandler(async (req: Request, res: Response) => { res.json({ product: await productsService.reinstateProduct(req.params.id, req.user!.sub, req.ip) }); });
