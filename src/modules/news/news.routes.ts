import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { validateUploadFile, uploadNewsImage } from "@/modules/uploads/uploads.service";

export const newsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const articleSchema = z.object({
  title: z.string().trim().min(3).max(180),
  slug: z.string().trim().max(180).optional().or(z.literal("")),
  excerpt: z.string().trim().min(10).max(400),
  content: z.string().trim().min(30).max(50000),
  coverImageUrl: z.string().url().optional().or(z.literal("")),
  coverImageAlt: z.string().trim().max(200).optional(),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(180).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "news";
}

async function uniqueSlug(value: string, exceptId?: string) {
  const base = slugify(value);
  let slug = base;
  let suffix = 2;
  while (await prisma.newsArticle.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

const publicArticleSelect = {
  id: true, title: true, slug: true, excerpt: true, coverImageUrl: true,
  coverImageAlt: true, seoTitle: true, seoDescription: true,
  publishedAt: true, createdAt: true, updatedAt: true,
} as const;

newsRouter.get("/", asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const where = { status: "PUBLISHED", publishedAt: { lte: new Date() } };
  const [articles, total] = await Promise.all([
    prisma.newsArticle.findMany({ where, select: publicArticleSelect, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.newsArticle.count({ where }),
  ]);
  res.json({ articles, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

newsRouter.get("/admin/articles", requireAuth, requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  const articles = await prisma.newsArticle.findMany({ orderBy: [{ updatedAt: "desc" }], take: 200 });
  res.json({ articles });
}));

newsRouter.post("/admin/articles", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const data = articleSchema.parse(req.body);
  const slug = await uniqueSlug(data.slug || data.title);
  const publishedAt = data.status === "PUBLISHED" ? new Date() : null;
  const article = await prisma.newsArticle.create({
    data: {
      title: data.title, slug, excerpt: data.excerpt, content: data.content,
      coverImageUrl: data.coverImageUrl || null, coverImageAlt: data.coverImageAlt || null,
      seoTitle: data.seoTitle || null, seoDescription: data.seoDescription || null,
      status: data.status, publishedAt, createdById: req.user!.sub,
    },
  });
  res.status(201).json({ article });
}));

newsRouter.patch("/admin/articles/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const data = articleSchema.partial().parse(req.body);
  const existing = await prisma.newsArticle.findUnique({ where: { id: req.params.id } });
  if (!existing) throw AppError.notFound("News article not found", "NEWS_ARTICLE_NOT_FOUND");
  const slug = data.slug !== undefined || data.title !== undefined
    ? await uniqueSlug(data.slug || data.title || existing.title, existing.id)
    : existing.slug;
  const status = data.status ?? existing.status;
  const publishedAt = status === "PUBLISHED"
    ? (existing.status === "PUBLISHED" && existing.publishedAt ? existing.publishedAt : new Date())
    : null;
  const article = await prisma.newsArticle.update({
    where: { id: existing.id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      slug,
      ...(data.excerpt !== undefined ? { excerpt: data.excerpt } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.coverImageUrl !== undefined ? { coverImageUrl: data.coverImageUrl || null } : {}),
      ...(data.coverImageAlt !== undefined ? { coverImageAlt: data.coverImageAlt || null } : {}),
      ...(data.seoTitle !== undefined ? { seoTitle: data.seoTitle || null } : {}),
      ...(data.seoDescription !== undefined ? { seoDescription: data.seoDescription || null } : {}),
      status, publishedAt,
    },
  });
  res.json({ article });
}));

newsRouter.delete("/admin/articles/:id", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const existing = await prisma.newsArticle.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) throw AppError.notFound("News article not found", "NEWS_ARTICLE_NOT_FOUND");
  await prisma.newsArticle.delete({ where: { id: existing.id } });
  res.status(204).send();
}));

newsRouter.get("/:slug", asyncHandler(async (req, res) => {
  const article = await prisma.newsArticle.findFirst({
    where: { slug: req.params.slug, status: "PUBLISHED", publishedAt: { lte: new Date() } },
  });
  if (!article) throw AppError.notFound("News article not found", "NEWS_ARTICLE_NOT_FOUND");
  res.json({ article });
}));
