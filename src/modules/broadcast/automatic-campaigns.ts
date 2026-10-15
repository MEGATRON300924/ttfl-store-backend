import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { renderEmailLayout, escapeHtml } from "@/lib/email-layout";
import { createNotification } from "@/modules/notifications/notifications.service";

type CampaignEvent = "FLASH_DEAL" | "SPONSORED_PRODUCT";

async function ensurePreferences() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ttfl_broadcast_preferences (id TEXT PRIMARY KEY DEFAULT 'global', auto_flash_deals BOOLEAN NOT NULL DEFAULT false, auto_sponsored_products BOOLEAN NOT NULL DEFAULT false, auto_new_products BOOLEAN NOT NULL DEFAULT false, flash_deals_web BOOLEAN NOT NULL DEFAULT true, flash_deals_email BOOLEAN NOT NULL DEFAULT false, sponsored_web BOOLEAN NOT NULL DEFAULT true, sponsored_email BOOLEAN NOT NULL DEFAULT false, new_products_web BOOLEAN NOT NULL DEFAULT true, new_products_email BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`INSERT INTO ttfl_broadcast_preferences(id) VALUES('global') ON CONFLICT(id) DO NOTHING`);
}

export async function sendAutomaticProductCampaign(event: CampaignEvent, productId: string, extra?: { discountPercent?: number; salePrice?: number }) {
  try {
    await ensurePreferences();
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT auto_flash_deals AS "autoFlashDeals", auto_sponsored_products AS "autoSponsoredProducts", flash_deals_web AS "flashDealsWeb", flash_deals_email AS "flashDealsEmail", sponsored_web AS "sponsoredWeb", sponsored_email AS "sponsoredEmail" FROM ttfl_broadcast_preferences WHERE id='global'`);
    const preferences = rows[0];
    const enabled = event === "FLASH_DEAL" ? preferences?.autoFlashDeals : preferences?.autoSponsoredProducts;
    const sendWeb = event === "FLASH_DEAL" ? preferences?.flashDealsWeb : preferences?.sponsoredWeb;
    const sendEmailChannel = event === "FLASH_DEAL" ? preferences?.flashDealsEmail : preferences?.sponsoredEmail;
    if (!enabled || (!sendWeb && !sendEmailChannel)) return { skipped: true };

    const product = await prisma.product.findFirst({
      where: { id: productId, status: "ACTIVE", deletedAt: null, comingSoon: false },
      select: { id: true, name: true, slug: true, price: true, images: { orderBy: { position: "asc" }, take: 1, select: { url: true } } },
    });
    if (!product) return { skipped: true };
    const title = event === "FLASH_DEAL" ? "A new Flash Deal is here" : "A product is now sponsored";
    const basePrice = Number(product.price);
    const price = extra?.salePrice ?? basePrice;
    const message = event === "FLASH_DEAL" && extra?.discountPercent
      ? `${product.name} is on Flash Deal with ${extra.discountPercent}% off. Shop before the deal ends.`
      : `Discover ${product.name} on TTFL Store.`;
    const url = `/products/${product.slug}`;
    const users = await prisma.user.findMany({ where: { status: "ACTIVE", role: "CUSTOMER" }, select: { id: true, email: true, firstName: true } });
    const productReference = { id: product.id, name: product.name, slug: product.slug, imageUrl: product.images[0]?.url ?? null, price };
    const webResults = sendWeb ? await Promise.allSettled(users.map(user => createNotification(user.id, {
      title, body: message, type: event === "FLASH_DEAL" ? "FLASH_DEAL" : "SPONSORED_PRODUCT", url,
      data: { productReferences: [productReference], buttons: [{ label: "View product", url }] }, sendPush: false,
    }))) : [];
    if (sendEmailChannel) {
      const productUrl = `https://ttflstore.name.ng/products/${product.slug}`;
      const image = productReference.imageUrl ? `<p style="text-align:center;"><a href="${escapeHtml(productUrl)}"><img src="${escapeHtml(productReference.imageUrl)}" alt="${escapeHtml(product.name)}" width="240" style="width:100%;max-width:240px;height:auto;border-radius:8px;" /></a></p>` : "";
      const offer = event === "FLASH_DEAL" && extra?.discountPercent ? `<p><strong>${extra.discountPercent}% off</strong> · Now ₦${price.toLocaleString("en-NG")}</p>` : `<p>Price: ₦${price.toLocaleString("en-NG")}</p>`;
      const html = renderEmailLayout({ heading: title, previewText: message, bodyHtml: `<p>Hi {{name}},</p><p>${escapeHtml(message)}</p>${image}<p><strong>${escapeHtml(product.name)}</strong></p>${offer}`, ctaText: "View product", ctaUrl: productUrl });
      await Promise.allSettled(users.map(user => sendEmail({ to: user.email, subject: title, html: html.replace("Hi {{name}},", `Hi ${escapeHtml(user.firstName || "there")},`), event: event === "FLASH_DEAL" ? "automatic_flash_deal" : "automatic_sponsored_product" })));
    }
    return { recipients: users.length, webQueued: webResults.filter(result => result.status === "fulfilled").length };
  } catch (error) {
    // Automatic campaigns must never block the product or promotion operation.
    console.error("[automatic-broadcast] Failed to send product campaign", event, error);
    return { skipped: true };
  }
}
