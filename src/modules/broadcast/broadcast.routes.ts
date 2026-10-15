import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendWhatsAppNotification, sendWhatsAppTemplate, testWhatsAppForAdmins } from "@/lib/whatsapp-notifications";
import { getWhatsAppAdminNumbers } from "@/modules/settings/settings.service";
import { renderEmailLayout, escapeHtml } from "@/lib/email-layout";
import { AppError } from "@/utils/app-error";
import { createNotification } from "@/modules/notifications/notifications.service";

export const broadcastRouter = Router();

async function ensureTables() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ttfl_broadcasts (id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, email_subject TEXT, send_popup BOOLEAN NOT NULL DEFAULT false, send_email BOOLEAN NOT NULL DEFAULT false, send_whatsapp BOOLEAN NOT NULL DEFAULT false, audience JSONB NOT NULL, recipient_count INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ttfl_broadcasts ADD COLUMN IF NOT EXISTS send_whatsapp BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ttfl_broadcasts ADD COLUMN IF NOT EXISTS send_web_notification BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ttfl_broadcasts ADD COLUMN IF NOT EXISTS product_references JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ttfl_broadcasts ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ttfl_broadcast_preferences (id TEXT PRIMARY KEY DEFAULT 'global', auto_flash_deals BOOLEAN NOT NULL DEFAULT false, auto_sponsored_products BOOLEAN NOT NULL DEFAULT false, auto_new_products BOOLEAN NOT NULL DEFAULT false, flash_deals_web BOOLEAN NOT NULL DEFAULT true, flash_deals_email BOOLEAN NOT NULL DEFAULT false, sponsored_web BOOLEAN NOT NULL DEFAULT true, sponsored_email BOOLEAN NOT NULL DEFAULT false, new_products_web BOOLEAN NOT NULL DEFAULT true, new_products_email BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`INSERT INTO ttfl_broadcast_preferences(id) VALUES('global') ON CONFLICT(id) DO NOTHING`);
}

const schema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(10000),
  emailSubject: z.string().trim().max(200).optional(),
  sendPopup: z.boolean().default(false),
  sendEmail: z.boolean().default(false),
  sendWhatsApp: z.boolean().default(false),
  sendWebNotification: z.boolean().default(false),
  productReferences: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(200), slug: z.string().min(1).max(240), imageUrl: z.string().url().max(2048).nullable().optional(), price: z.number().nonnegative().optional() })).max(8).default([]),
  buttons: z.array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value), "Button URL must use HTTP or HTTPS") })).max(5).default([]),
  audience: z.object({
    mode: z.enum(["ALL", "SELECTED", "NEW", "EXISTING", "VERIFIED", "UNVERIFIED", "VENDORS", "CUSTOMERS"]),
    days: z.number().int().positive().max(3650).optional(),
    userIds: z.array(z.string().uuid()).max(500).optional(),
  }),
});

const whatsappSchema = z.object({
  audience: z.enum(["ADMINS", "CUSTOMERS"]),
  type: z.enum(["TEXT", "TEMPLATE"]),
  message: z.string().trim().max(10000).optional(),
  templateName: z.string().trim().min(1).max(100).optional(),
  templateLanguage: z.string().trim().min(2).max(35).optional(),
  bodyParameters: z.array(z.string().max(1024)).max(20).optional(),
  buttonUrlParameters: z.array(z.string().max(2048)).max(10).optional(),
});

function matchesAudience(audience: any, user: { id: string; role: string; emailVerified: boolean; createdAt: Date }) {
  if (audience.mode === "ALL") return true;
  if (audience.mode === "SELECTED") return (audience.userIds ?? []).includes(user.id);
  if (audience.mode === "VERIFIED") return user.emailVerified;
  if (audience.mode === "UNVERIFIED") return !user.emailVerified;
  if (audience.mode === "VENDORS") return user.role === "VENDOR";
  if (audience.mode === "CUSTOMERS") return user.role === "CUSTOMER";
  const cutoff = new Date(Date.now() - (audience.days ?? 7) * 86400000);
  return audience.mode === "NEW" ? user.createdAt >= cutoff : user.createdAt < cutoff;
}

broadcastRouter.get("/popup", requireAuth, asyncHandler(async (req, res) => {
  await ensureTables();
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { id: true, role: true, emailVerified: true, createdAt: true } });
  if (!user) throw AppError.notFound("User not found");
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, title, message, audience, product_references AS "productReferences", buttons, created_at AS "createdAt" FROM ttfl_broadcasts WHERE send_popup = true AND created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 20`);
  res.json({ items: rows.filter(row => matchesAudience(row.audience, user)) });
}));

broadcastRouter.get("/public-popup", asyncHandler(async (_req, res) => {
  await ensureTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, title, message, product_references AS "productReferences", buttons, created_at AS "createdAt" FROM ttfl_broadcasts WHERE send_popup = true AND created_at > NOW() - INTERVAL '30 days' AND audience->>'mode' = 'ALL' ORDER BY created_at DESC LIMIT 20`);
  res.json({ items: rows });
}));

broadcastRouter.get("/admin/preferences", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  await ensureTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT auto_flash_deals AS "autoFlashDeals", auto_sponsored_products AS "autoSponsoredProducts", auto_new_products AS "autoNewProducts", flash_deals_web AS "flashDealsWeb", flash_deals_email AS "flashDealsEmail", sponsored_web AS "sponsoredWeb", sponsored_email AS "sponsoredEmail", new_products_web AS "newProductsWeb", new_products_email AS "newProductsEmail", updated_at AS "updatedAt" FROM ttfl_broadcast_preferences WHERE id='global'`);
  res.json({ preferences: rows[0] ?? {} });
}));

broadcastRouter.put("/admin/preferences", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  await ensureTables();
  const input = z.object({
    autoFlashDeals: z.boolean(), autoSponsoredProducts: z.boolean(), autoNewProducts: z.boolean(),
    flashDealsWeb: z.boolean(), flashDealsEmail: z.boolean(), sponsoredWeb: z.boolean(),
    sponsoredEmail: z.boolean(), newProductsWeb: z.boolean(), newProductsEmail: z.boolean(),
  }).parse(req.body);
  const rows = await prisma.$queryRawUnsafe<any[]>(`UPDATE ttfl_broadcast_preferences SET auto_flash_deals=$1,auto_sponsored_products=$2,auto_new_products=$3,flash_deals_web=$4,flash_deals_email=$5,sponsored_web=$6,sponsored_email=$7,new_products_web=$8,new_products_email=$9,updated_at=NOW() WHERE id='global' RETURNING auto_flash_deals AS "autoFlashDeals", auto_sponsored_products AS "autoSponsoredProducts", auto_new_products AS "autoNewProducts", flash_deals_web AS "flashDealsWeb", flash_deals_email AS "flashDealsEmail", sponsored_web AS "sponsoredWeb", sponsored_email AS "sponsoredEmail", new_products_web AS "newProductsWeb", new_products_email AS "newProductsEmail", updated_at AS "updatedAt"`, input.autoFlashDeals, input.autoSponsoredProducts, input.autoNewProducts, input.flashDealsWeb, input.flashDealsEmail, input.sponsoredWeb, input.sponsoredEmail, input.newProductsWeb, input.newProductsEmail);
  res.json({ preferences: rows[0] });
}));

broadcastRouter.get("/admin/products", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  await ensureTables();
  const search = String(req.query.search ?? "").trim().slice(0, 120);
  if (search.length < 2) return res.json({ items: [] });
  const items = await prisma.product.findMany({
    where: { status: "ACTIVE", deletedAt: null, comingSoon: false, OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] },
    select: { id: true, name: true, slug: true, price: true, images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } },
    take: 12, orderBy: { updatedAt: "desc" },
  });
  res.json({ items: items.map(product => ({ id: product.id, name: product.name, slug: product.slug, price: Number(product.price), imageUrl: product.images[0]?.url ?? null, url: `/products/${product.slug}` })) });
}));

broadcastRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  await ensureTables();
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, title, message, email_subject AS "emailSubject", send_popup AS "sendPopup", send_email AS "sendEmail", send_whatsapp AS "sendWhatsApp", send_web_notification AS "sendWebNotification", product_references AS "productReferences", buttons, audience, recipient_count AS "recipientCount", created_at AS "createdAt" FROM ttfl_broadcasts ORDER BY created_at DESC LIMIT 100`);
  res.json({ items: rows });
}));

broadcastRouter.post("/admin/test-whatsapp", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const result = await testWhatsAppForAdmins("TTFL Store WhatsApp test successful. Your Meta WhatsApp Cloud API connection is responding correctly.");
  if (!result.delivered) throw AppError.badRequest(result.error || "WhatsApp test failed");
  res.json({ ok: true, status: result.status, messageId: result.messageId });
}));

broadcastRouter.post("/admin/whatsapp", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const input = whatsappSchema.parse(req.body);
  if (input.type === "TEXT" && !input.message) throw AppError.badRequest("Message is required for normal text WhatsApp notifications");
  if (input.type === "TEMPLATE" && !input.templateName) throw AppError.badRequest("Template name is required");

  const adminNumbers = input.audience === "ADMINS" ? await getWhatsAppAdminNumbers() : [];
  const customerRows = input.audience === "CUSTOMERS"
    ? await prisma.user.findMany({ where: { status: "ACTIVE", role: "CUSTOMER" }, select: { phone: true } })
    : [];
  const rawRecipients = input.audience === "ADMINS" ? adminNumbers : customerRows.map(user => user.phone).filter(Boolean) as string[];
  const missingNumbers = input.audience === "CUSTOMERS" ? customerRows.filter(user => !user.phone?.replace(/\D/g, "")).length : 0;
  const recipients = Array.from(new Set(rawRecipients.map(number => number.replace(/\D/g, "")).filter(Boolean)));

  if (!recipients.length) {
    return res.status(200).json({ ok: false, sent: 0, failed: 0, skipped: missingNumbers, error: input.audience === "ADMINS" ? "No WhatsApp admin numbers are configured." : "No active customers with saved WhatsApp numbers were found." });
  }

  const results = await Promise.all(recipients.map(async (to) => {
    if (input.type === "TEMPLATE") {
      return sendWhatsAppTemplate({
        to,
        templateName: input.templateName!,
        languageCode: input.templateLanguage,
        bodyParameters: input.bodyParameters,
        buttonUrlParameters: input.buttonUrlParameters,
        event: `admin_whatsapp_${input.audience.toLowerCase()}_template`,
      });
    }
    return sendWhatsAppNotification({ to, message: input.message!, event: `admin_whatsapp_${input.audience.toLowerCase()}_text` });
  }));

  const sent = results.filter(result => result.delivered).length;
  const failed = results.length - sent;
  const firstFailure = results.find(result => !result.delivered && result.error)?.error;
  res.status(201).json({ ok: failed === 0, sent, failed, skipped: missingNumbers, error: firstFailure });
}));

broadcastRouter.post("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  await ensureTables();
  const input = schema.parse(req.body);
  if (!input.sendPopup && !input.sendEmail && !input.sendWhatsApp && !input.sendWebNotification) throw AppError.badRequest("Choose popup, web notification, email, WhatsApp, or a combination");
  if (input.sendEmail && !input.emailSubject) throw AppError.badRequest("Email subject is required when email is enabled");
  if (input.audience.mode === "SELECTED" && !input.audience.userIds?.length) throw AppError.badRequest("Select at least one user");

  const where: any = { status: "ACTIVE" };
  if (input.audience.mode === "SELECTED") where.id = { in: input.audience.userIds ?? [] };
  if (input.audience.mode === "NEW") where.createdAt = { gte: new Date(Date.now() - (input.audience.days ?? 7) * 86400000) };
  if (input.audience.mode === "EXISTING") where.createdAt = { lt: new Date(Date.now() - (input.audience.days ?? 7) * 86400000) };
  if (input.audience.mode === "VERIFIED") where.emailVerified = true;
  if (input.audience.mode === "UNVERIFIED") where.emailVerified = false;
  if (input.audience.mode === "VENDORS") where.role = "VENDOR";
  if (input.audience.mode === "CUSTOMERS") where.role = "CUSTOMER";

  const users = await prisma.user.findMany({ where, select: { id: true, email: true, firstName: true, phone: true } });
  const id = randomBytes(16).toString("hex");
  await prisma.$executeRawUnsafe(`INSERT INTO ttfl_broadcasts (id, title, message, email_subject, send_popup, send_email, send_whatsapp, send_web_notification, product_references, buttons, audience, recipient_count, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)`, id, input.title, input.message, input.emailSubject ?? null, input.sendPopup, input.sendEmail, input.sendWhatsApp, input.sendWebNotification, JSON.stringify(input.productReferences), JSON.stringify(input.buttons), JSON.stringify(input.audience), users.length, req.user!.sub);

  let webNotificationsSent = 0;
  if (input.sendWebNotification) {
    const results = await Promise.allSettled(users.map(user => createNotification(user.id, {
      title: input.title,
      body: input.message,
      type: "BROADCAST",
      data: { broadcastId: id, productReferences: input.productReferences, buttons: input.buttons },
      url: input.buttons[0]?.url ?? (input.productReferences[0] ? `/products/${input.productReferences[0].slug}` : "/notifications"),
      sendPush: false,
    })));
    webNotificationsSent = results.filter(result => result.status === "fulfilled").length;
  }

  if (input.sendEmail) {
    for (const user of users) {
      const html = renderEmailLayout({ heading: input.title, previewText: input.message.slice(0, 140), bodyHtml: `<p>Hi ${escapeHtml(user.firstName || "there")},</p><p>${escapeHtml(input.message).replace(/\n/g, "<br />")}</p>` });
      void sendEmail({ to: user.email, subject: input.emailSubject!, html, event: "admin_broadcast" });
    }
  }

  let whatsappSent = 0;
  let whatsappFailed = 0;
  let whatsappSkipped = 0;
  if (input.sendWhatsApp) {
    const recipients = users.filter(user => Boolean(user.phone));
    whatsappSkipped = users.length - recipients.length;
    const results = await Promise.allSettled(recipients.map(user => sendWhatsAppNotification({ to: user.phone!, message: input.message, event: "admin_broadcast" })));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.delivered) whatsappSent += 1;
      else whatsappFailed += 1;
    }
  }

  res.status(201).json({ id, recipientCount: users.length, webNotificationsSent, whatsappSent, whatsappFailed, whatsappSkipped });
}));
