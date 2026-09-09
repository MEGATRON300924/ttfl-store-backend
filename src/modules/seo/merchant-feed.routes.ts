import { Router } from "express";
import { prisma } from "@/lib/prisma";

const SITE = "https://ttflstore.name.ng";
const xml = (value: string) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export const merchantFeedRouter = Router();
merchantFeedRouter.get("/merchant.xml", async (_req, res) => {
  const products = await prisma.product.findMany({ where: { deletedAt: null, status: "ACTIVE", comingSoon: false }, include: { images: { orderBy: { position: "asc" }, take: 1 }, vendor: true }, take: 5000 });
  const body = products.map((p) => `<item><g:id>${xml(p.publicProductId || p.id)}</g:id><g:title>${xml(p.name)}</g:title><g:description>${xml(p.description)}</g:description><link>${SITE}/products/${encodeURIComponent(p.slug)}</link>${p.images[0] ? `<g:image_link>${xml(p.images[0].url)}</g:image_link>` : ""}<g:availability>${Number(p.stock) > 0 ? "in_stock" : "out_of_stock"}</g:availability><g:price>${Number(p.price).toFixed(2)} NGN</g:price><g:condition>${String(p.condition).toLowerCase() === "new" ? "new" : "used"}</g:condition><g:brand>${xml(p.vendor.storeName)}</g:brand></item>`).join("");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>TTFL Store</title><link>${SITE}</link>${body}</channel></rss>`);
});
