import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as service from "./store-reports.service";

export const storeReportsRouter = Router();

const createSchema = z.object({
  vendorId: z.string().uuid(),
  reason: z.enum(service.REPORT_REASONS),
  description: z.string().trim().min(20).max(5000),
  evidenceLinks: z.array(z.string().url().max(2000)).min(1).max(10),
  orderNumber: z.string().trim().max(80).optional(),
});

storeReportsRouter.post("/", requireAuth, requireRole("CUSTOMER"), asyncHandler(async (req,res) => {
  const body=createSchema.parse(req.body);
  const report=await service.createStoreReport(req.user!.sub, body.vendorId, body.reason, body.description, body.evidenceLinks, body.orderNumber);
  res.status(201).json({ report });
}));

storeReportsRouter.get("/me", requireAuth, requireRole("CUSTOMER"), asyncHandler(async (req,res) => {
  res.json({ reports: await service.getMyReports(req.user!.sub) });
}));

const statusQuery=z.enum(service.REPORT_STATUSES).optional();
storeReportsRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async(req,res) => {
  res.json({ reports: await service.adminListReports(statusQuery.parse(req.query.status)) });
}));

const adminSchema=z.object({ status:z.enum(service.REPORT_STATUSES), adminNotes:z.string().trim().max(5000).optional() });
storeReportsRouter.patch("/admin/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async(req,res) => {
  const body=adminSchema.parse(req.body);
  const report=await service.adminSetReportStatus(req.params.id, body.status, body.adminNotes, req.user!.sub);
  res.json({ report });
}));
