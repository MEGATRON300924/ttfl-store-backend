import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as errorLogging from "./error-logging.service";

export const errorLoggingRouter = Router();

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

errorLoggingRouter.get("/admin/error-logs", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { q, page, limit } = querySchema.parse(req.query);
  res.json(await errorLogging.searchErrorLogs(q, page, limit));
}));

errorLoggingRouter.get("/admin/error-logs/:referenceCode", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const log = await errorLogging.getErrorLog(req.params.referenceCode);
  if (!log) return res.status(404).json({ error: { code: "ERROR_LOG_NOT_FOUND", message: "Error log not found." } });
  res.json({ log });
}));
