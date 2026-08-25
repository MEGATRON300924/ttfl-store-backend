import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as supportService from "./support.service";

export const supportRouter = Router();

const startSchema = z.object({
  message: z.string().min(1).max(2000),
  orderNumber: z.string().optional(),
});

supportRouter.post(
  "/conversations",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const { message, orderNumber } = startSchema.parse(req.body);
    const conversation = await supportService.startConversation(req.user!.sub, message, orderNumber);
    res.status(201).json({ conversation });
  })
);

supportRouter.get(
  "/conversations/me",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const conversations = await supportService.getMyConversations(req.user!.sub);
    res.json({ conversations });
  })
);

supportRouter.get(
  "/conversations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversation = await supportService.getConversation(req.params.id, req.user!.sub, req.user!.role);
    res.json({ conversation });
  })
);

const messageSchema = z.object({ body: z.string().min(1).max(2000) });

supportRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { body } = messageSchema.parse(req.body);
    // Only customers and admins can post through this REST endpoint today
    // (vendors aren't part of the support loop in this pass); admin posts
    // are tagged AGENT, everyone else CUSTOMER.
    const senderType = req.user!.role === "ADMIN" ? "AGENT" : "CUSTOMER";
    const message = await supportService.postMessage(req.params.id, req.user!.sub, senderType, body);
    res.status(201).json({ message });
  })
);

// --- Admin -----------------------------------------------------------------

const statusQuerySchema = z.object({ status: z.enum(["OPEN", "ASSIGNED", "RESOLVED", "CLOSED"]).optional() });

supportRouter.get(
  "/admin/conversations",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = statusQuerySchema.parse(req.query);
    const conversations = await supportService.adminListConversations(status);
    res.json({ conversations });
  })
);

supportRouter.post(
  "/admin/conversations/:id/assign",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const conversation = await supportService.adminAssignConversation(req.params.id, req.user!.sub);
    res.json({ conversation });
  })
);

const statusBodySchema = z.object({ status: z.enum(["RESOLVED", "CLOSED", "OPEN"]) });

supportRouter.patch(
  "/admin/conversations/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = statusBodySchema.parse(req.body);
    const conversation = await supportService.adminSetStatus(req.params.id, status);
    res.json({ conversation });
  })
);
