import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import * as adminAnalytics from "./admin-analytics.service";
import * as vendorAnalytics from "./vendor-analytics.service";
import * as logsService from "./logs.service";

export const analyticsRouter = Router();

const rangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// --- Admin -------------------------------------------------------------

analyticsRouter.get(
  "/admin/overview",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const range = rangeSchema.parse(req.query);
    const overview = await adminAnalytics.getOverview(range);
    res.json({ overview });
  })
);

const timeSeriesSchema = rangeSchema.extend({
  granularity: z.enum(["day", "week", "month"]).default("day"),
});

analyticsRouter.get(
  "/admin/revenue-timeseries",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { granularity, ...range } = timeSeriesSchema.parse(req.query);
    const series = await adminAnalytics.getRevenueTimeSeries(granularity, range);
    res.json({ series });
  })
);

analyticsRouter.get(
  "/admin/commission-center",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const range = rangeSchema.parse(req.query);
    const data = await adminAnalytics.getCommissionCenter(range);
    res.json(data);
  })
);

// --- Vendor --------------------------------------------------------------

analyticsRouter.get(
  "/vendor/overview",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const range = rangeSchema.parse(req.query);
    const overview = await vendorAnalytics.getVendorOverview(vendor.id, range);
    res.json({ overview });
  })
);

analyticsRouter.get(
  "/vendor/best-products",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const products = await vendorAnalytics.getBestPerformingProducts(vendor.id, Number(req.query.limit ?? 10));
    res.json({ products });
  })
);

analyticsRouter.get(
  "/vendor/traffic-sources",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const range = rangeSchema.parse(req.query);
    const sources = await vendorAnalytics.getTrafficSources(vendor.id, range);
    res.json({ sources });
  })
);

// --- Admin logs (spec §28) --------------------------------------------

const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

analyticsRouter.get(
  "/admin/audit-logs",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { page, limit } = logsQuerySchema.parse(req.query);
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const result = await logsService.listAuditLogs(page, limit, action);
    res.json(result);
  })
);

analyticsRouter.get(
  "/admin/email-logs",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { page, limit } = logsQuerySchema.parse(req.query);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const result = await logsService.listEmailLogs(page, limit, status);
    res.json(result);
  })
);
