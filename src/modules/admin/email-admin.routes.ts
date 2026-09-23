import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { env } from "@/config/env";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { renderEmailLayout } from "@/lib/email-layout";

export const emailAdminRouter = Router();

emailAdminRouter.use(requireAuth, requireRole("ADMIN"));

emailAdminRouter.get("/status", asyncHandler(async (_req, res) => {
  const [pending, retrying, failed] = await Promise.all([
    prisma.emailLog.count({ where: { status: "PENDING" } }),
    prisma.emailLog.count({ where: { status: "RETRYING" } }),
    prisma.emailLog.count({ where: { status: "FAILED" } }),
  ]);

  res.json({
    provider: env.email.provider,
    from: env.email.from,
    adminNotificationEmail: env.adminNotificationEmail ?? null,
    configured: env.email.provider !== "console",
    queue: { pending, retrying, failed },
  });
}));

emailAdminRouter.post("/test", asyncHandler(async (req, res) => {
  const admin = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { email: true, firstName: true },
  });
  if (!admin?.email) {
    res.status(400).json({ message: "Your admin account does not have an email address." });
    return;
  }

  const notification = {
    subject: "TTFL Store email delivery test",
    html: renderEmailLayout({
      heading: "Email delivery is working",
      previewText: "This is a TTFL Store administrator email test.",
      bodyHtml: `<p>Hi ${admin.firstName || "there"},</p><p>This test was requested from the TTFL Store Admin Portal.</p><p>If you received this message, the configured email provider accepted the message and the TTFL Store email queue is working.</p><p><strong>Provider:</strong> ${env.email.provider}</p>`,
    }),
    event: "admin_email_test",
  };

  const log = await sendEmail({ to: admin.email, ...notification });
  res.json({
    message: `A test email was queued for ${admin.email}.`,
    emailLogId: log?.id ?? null,
  });
}));
