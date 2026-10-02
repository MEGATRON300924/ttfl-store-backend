import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import * as adminAnalytics from "./admin-analytics.service";
import * as vendorAnalytics from "./vendor-analytics.service";
import * as logsService from "./logs.service"; import * as maxAiAnalytics from "./max-ai-analytics.service"; import { env } from "@/config/env"; import { AppError } from "@/utils/app-error";

export const analyticsRouter = Router();
const rangeSchema = z.object({ startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional() });
analyticsRouter.get("/admin/overview", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.json({ overview: await adminAnalytics.getOverview(rangeSchema.parse(req.query)) }); }));
const timeSeriesSchema = rangeSchema.extend({ granularity: z.enum(["day", "week", "month"]).default("day") });
analyticsRouter.get("/admin/revenue-timeseries", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const { granularity, ...range } = timeSeriesSchema.parse(req.query); res.json({ series: await adminAnalytics.getRevenueTimeSeries(granularity, range) }); }));
analyticsRouter.get("/admin/commission-center", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { res.json(await adminAnalytics.getCommissionCenter(rangeSchema.parse(req.query))); }));
analyticsRouter.get("/vendor/overview", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ overview: await vendorAnalytics.getVendorOverview(vendor.id, rangeSchema.parse(req.query)) }); }));
analyticsRouter.get("/vendor/best-products", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ products: await vendorAnalytics.getBestPerformingProducts(vendor.id, Number(req.query.limit ?? 10)) }); }));
analyticsRouter.get("/vendor/traffic-sources", requireAuth, requireRole("VENDOR"), asyncHandler(async (req, res) => { const vendor = await getVendorProfileForUser(req.user!.sub); res.json({ sources: await vendorAnalytics.getTrafficSources(vendor.id, rangeSchema.parse(req.query)) }); }));
analyticsRouter.get("/max-ai/store/:storeId", asyncHandler(async (req, res) => {
  const storeId = req.params.storeId;
  const apiKey = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  const authenticatedVendor = req.user ? await getVendorProfileForUser(req.user.sub).catch(() => null) : null;
  if (authenticatedVendor) {
    if (authenticatedVendor.id !== storeId) throw AppError.forbidden("You can only view analytics for your own store");
  } else if (!env.maxAi.analyticsApiKey || apiKey !== env.maxAi.analyticsApiKey) {
    throw AppError.unauthorized("Max AI analytics authentication is required", "MAX_AI_ANALYTICS_UNAUTHORIZED");
  }
  const refresh = String(req.query.refresh ?? "") === "1";
  res.json({ analytics: await maxAiAnalytics.getMaxAiStoreAnalytics(storeId, refresh) });
}));
const logsQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
analyticsRouter.get("/admin/audit-logs", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const { page, limit } = logsQuerySchema.parse(req.query); const action = typeof req.query.action === "string" ? req.query.action : undefined; res.json(await logsService.listAuditLogs(page, limit, action)); }));
analyticsRouter.get("/admin/email-logs", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => { const { page, limit } = logsQuerySchema.parse(req.query); const status = typeof req.query.status === "string" ? req.query.status : undefined; res.json(await logsService.listEmailLogs(page, limit, status)); }));
