import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const partnerEventsRouter = Router();

const partnerSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  description: z.string().trim().max(3000).optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  contactEmail: z.string().email().max(320).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional(),
});

const eventSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(10000),
  coverImageUrl: z.string().url().optional().or(z.literal("")),
  audience: z.enum(["VENDORS", "CUSTOMERS", "EVERYONE"]).default("EVERYONE"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().or(z.literal("")),
  registrationDeadline: z.string().datetime().optional().or(z.literal("")),
  eventType: z.string().trim().min(2).max(80).default("Virtual"),
  location: z.string().trim().max(200).optional(),
  registrationUrl: z.string().url().optional().or(z.literal("")),
  organizerName: z.string().trim().max(160).optional(),
  organizerEmail: z.string().email().max(320).optional().or(z.literal("")),
  organizerPhone: z.string().trim().max(40).optional(),
});

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "event";
}

async function uniqueSlug(base: string) {
  const clean = slugify(base);
  let slug = clean;
  let n = 2;
  while (await prisma.partnerEvent.findUnique({ where: { slug } })) slug = `${clean}-${n++}`;
  return slug;
}

async function getPartner(userId: string) {
  return prisma.partner.findUnique({ where: { ownerUserId: userId } });
}

partnerEventsRouter.get("/events", asyncHandler(async (req, res) => {
  const audience = typeof req.query.audience === "string" && ["VENDORS", "CUSTOMERS", "EVERYONE"].includes(req.query.audience)
    ? req.query.audience as "VENDORS" | "CUSTOMERS" | "EVERYONE"
    : undefined;
  const events = await prisma.partnerEvent.findMany({
    where: {
      status: "PUBLISHED",
      startsAt: { gte: new Date() },
      ...(audience ? { audience: { in: [audience, "EVERYONE"] } } : {}),
    },
    include: { partner: { select: { organizationName: true, slug: true, logoUrl: true, status: true } } },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  res.json({ events });
}));

partnerEventsRouter.get("/events/:slug", asyncHandler(async (req, res) => {
  const event = await prisma.partnerEvent.findFirst({
    where: { slug: req.params.slug, status: "PUBLISHED" },
    include: { partner: { select: { organizationName: true, slug: true, logoUrl: true, websiteUrl: true, description: true } } },
  });
  if (!event) throw AppError.notFound("Event not found");
  res.json({ event });
}));

partnerEventsRouter.post("/partners/register", requireAuth, asyncHandler(async (req, res) => {
  const data = partnerSchema.parse(req.body);
  const existing = await getPartner(req.user!.sub);
  if (existing) throw AppError.conflict("You already have a partner profile", "PARTNER_EXISTS");
  const slug = await uniquePartnerSlug(data.organizationName);
  const partner = await prisma.partner.create({
    data: {
      ownerUserId: req.user!.sub,
      organizationName: data.organizationName,
      slug,
      description: data.description || null,
      logoUrl: data.logoUrl || null,
      websiteUrl: data.websiteUrl || null,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone || null,
    },
  });
  res.status(201).json({ partner, message: "Partner application submitted for review." });
}));

async function uniquePartnerSlug(base: string) {
  const clean = slugify(base);
  let slug = clean;
  let n = 2;
  while (await prisma.partner.findUnique({ where: { slug } })) slug = `${clean}-${n++}`;
  return slug;
}

partnerEventsRouter.get("/partners/me", requireAuth, asyncHandler(async (req, res) => {
  const partner = await getPartner(req.user!.sub);
  res.json({ partner });
}));

partnerEventsRouter.get("/partners/me/events", requireAuth, asyncHandler(async (req, res) => {
  const partner = await getPartner(req.user!.sub);
  if (!partner) throw AppError.notFound("Create a partner profile first", "PARTNER_NOT_FOUND");
  const events = await prisma.partnerEvent.findMany({ where: { partnerId: partner.id }, orderBy: { createdAt: "desc" } });
  res.json({ partner, events });
}));

partnerEventsRouter.post("/partners/me/events", requireAuth, asyncHandler(async (req, res) => {
  const partner = await getPartner(req.user!.sub);
  if (!partner) throw AppError.notFound("Create a partner profile first", "PARTNER_NOT_FOUND");
  if (partner.status !== "APPROVED") throw AppError.forbidden("Your partner profile must be approved before you can submit events", "PARTNER_NOT_APPROVED");
  const data = eventSchema.parse(req.body);
  const startsAt = new Date(data.startsAt);
  const endsAt = data.endsAt ? new Date(data.endsAt) : null;
  if (endsAt && endsAt <= startsAt) throw AppError.badRequest("Event end time must be after the start time");
  const slug = await uniqueSlug(data.title);
  const event = await prisma.partnerEvent.create({
    data: {
      id: randomUUID(),
      partnerId: partner.id,
      title: data.title,
      slug,
      description: data.description,
      coverImageUrl: data.coverImageUrl || null,
      audience: data.audience,
      status: "PENDING_REVIEW",
      eventPlan: partner.eventPlan,
      startsAt,
      endsAt,
      registrationDeadline: data.registrationDeadline ? new Date(data.registrationDeadline) : null,
      eventType: data.eventType,
      location: data.location || null,
      registrationUrl: data.registrationUrl || null,
      organizerName: data.organizerName || partner.organizationName,
      organizerEmail: data.organizerEmail || partner.contactEmail,
      organizerPhone: data.organizerPhone || partner.contactPhone,
    },
  });
  res.status(201).json({ event, message: "Event submitted for TTFL Store review." });
}));

partnerEventsRouter.get("/admin/partners", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const partners = await prisma.partner.findMany({
    include: { owner: { select: { id: true, email: true, firstName: true, lastName: true } }, _count: { select: { events: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ partners });
}));

partnerEventsRouter.patch("/admin/partners/:id/status", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const status = z.object({ status: z.enum(["PENDING", "APPROVED", "SUSPENDED", "REJECTED"]) }).parse(req.body).status;
  const partner = await prisma.partner.update({ where: { id: req.params.id }, data: { status } });
  res.json({ partner });
}));

partnerEventsRouter.patch("/admin/partners/:id/event-access", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const data = z.object({
    plan: z.enum(["FREE", "FEATURED", "PREMIUM", "ENTERPRISE"]),
    complimentary: z.boolean().default(false),
    expiresAt: z.string().datetime().nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  }).parse(req.body);
  const partner = await prisma.partner.update({
    where: { id: req.params.id },
    data: {
      eventPlan: data.plan,
      complimentaryAccess: data.complimentary,
      complimentaryAccessExpiresAt: data.complimentary && data.expiresAt ? new Date(data.expiresAt) : null,
      complimentaryAccessReason: data.complimentary ? data.reason || "Complimentary partner access" : null,
    },
  });
  res.json({ partner, message: data.complimentary ? "Complimentary event-plan access granted." : "Event-plan access updated." });
}));

partnerEventsRouter.post("/admin/events/test", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  startsAt.setMinutes(0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const registrationDeadline = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);

  let partner = await prisma.partner.findFirst({ orderBy: { createdAt: "asc" } });
  if (!partner) {
    const admin = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!admin) throw AppError.notFound("Admin user not found");
    partner = await prisma.partner.create({
      data: {
        ownerUserId: admin.id,
        organizationName: "TTFL Store Test Partner",
        slug: "ttfl-store-test-partner",
        description: "Internal partner profile used for TTFL Store event testing.",
        contactEmail: admin.email,
        status: "APPROVED",
        eventPlan: "ENTERPRISE",
        complimentaryAccess: true,
        complimentaryAccessReason: "Internal test event",
      },
    });
  }

  const existing = await prisma.partnerEvent.findUnique({ where: { slug: "ttfl-store-test-event" } });
  const data = {
    partnerId: partner.id,
    title: "TTFL Store Test Event",
    description: "TEST EVENT — This is a real published event created from the TTFL Store admin page so you can preview the public event experience.",
    coverImageUrl: null,
    audience: "EVERYONE",
    status: "PUBLISHED",
    eventPlan: "FREE",
    startsAt,
    endsAt,
    registrationDeadline,
    eventType: "Virtual",
    location: "Online — TTFL Store",
    registrationUrl: null,
    organizerName: "TTFL Store",
    organizerEmail: null,
    organizerPhone: null,
    publishedAt: now,
  };

  const event = existing
    ? await prisma.partnerEvent.update({ where: { id: existing.id }, data })
    : await prisma.partnerEvent.create({ data: { id: randomUUID(), slug: "ttfl-store-test-event", ...data } });

  res.status(existing ? 200 : 201).json({
    event,
    message: "Test event published. Open the homepage or Events page to preview it.",
  });
}));

partnerEventsRouter.delete("/admin/events/test", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const existing = await prisma.partnerEvent.findUnique({ where: { slug: "ttfl-store-test-event" } });
  if (!existing) return res.json({ message: "No test event exists." });
  await prisma.partnerEvent.delete({ where: { id: existing.id } });
  res.json({ message: "Test event removed." });
}));

partnerEventsRouter.patch("/admin/events/:id/status", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const status = z.object({ status: z.enum(["PUBLISHED", "REJECTED", "CANCELLED"]) }).parse(req.body).status;
  const event = await prisma.partnerEvent.update({
    where: { id: req.params.id },
    data: { status, publishedAt: status === "PUBLISHED" ? new Date() : null },
  });
  res.json({ event });
}));

partnerEventsRouter.get("/admin/events", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const events = await prisma.partnerEvent.findMany({
    include: { partner: { select: { id: true, organizationName: true, status: true, eventPlan: true, complimentaryAccess: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ events });
}));
