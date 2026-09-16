import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { sendEmail } from "@/lib/email";
import { renderEmailLayout, escapeHtml } from "@/lib/email-layout";
import { sendWhatsAppNotification } from "@/lib/whatsapp-notifications";

let running = false;

async function processBackInStock() {
  const alerts = await prisma.productAlert.findMany({
    where: {
      type: "BACK_IN_STOCK",
      notifiedAt: null,
    },
    select: {
      id: true,
      productId: true,
      email: true,
      whatsapp: true,
    },
    take: 100,
  });

  if (!alerts.length) return;

  const products = await prisma.product.findMany({
    where: {
      id: { in: alerts.map((alert) => alert.productId) },
      deletedAt: null,
      status: "ACTIVE",
      stock: { gt: 0 },
    },
    select: { id: true, name: true, slug: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const alert of alerts) {
    const product = productById.get(alert.productId);
    if (!product) continue;

    let delivered = false;
    if (alert.email) {
      try {
        await sendEmail({
          to: alert.email,
          subject: `${product.name} is back in stock`,
          html: renderEmailLayout({
            heading: "Back in stock",
            previewText: `${product.name} is available again.`,
            bodyHtml: `<p><strong>${escapeHtml(product.name)}</strong> is back in stock on TTFL Store.</p>`,
            ctaText: "Shop now",
            ctaUrl: `${env.appUrl}/products/${product.slug}`,
          }),
          event: "product_back_in_stock",
        });
        delivered = true;
      } catch {}
    }
    if (alert.whatsapp) {
      try {
        const result = await sendWhatsAppNotification({
          to: alert.whatsapp,
          message: `${product.name} is back in stock on TTFL Store. ${env.appUrl}/products/${product.slug}`,
          event: "product_back_in_stock",
        });
        delivered = delivered || Boolean(result.delivered);
      } catch {}
    }
    if (delivered) {
      await prisma.productAlert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
    }
  }
}

async function processPriceDrops() {
  const alerts = await prisma.productAlert.findMany({
    where: {
      type: "PRICE_DROP",
      notifiedAt: null,
      targetPrice: { not: null },
    },
    select: {
      id: true,
      productId: true,
      email: true,
      whatsapp: true,
      targetPrice: true,
    },
    take: 100,
  });

  if (!alerts.length) return;

  const products = await prisma.product.findMany({
    where: {
      id: { in: alerts.map((alert) => alert.productId) },
      deletedAt: null,
      status: "ACTIVE",
    },
    select: { id: true, name: true, slug: true, price: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const alert of alerts) {
    const product = productById.get(alert.productId);
    if (!product || alert.targetPrice == null) continue;
    if (Number(product.price) > Number(alert.targetPrice)) continue;

    let delivered = false;
    if (alert.email) {
      try {
        await sendEmail({
          to: alert.email,
          subject: `Price drop: ${product.name}`,
          html: renderEmailLayout({
            heading: "Price dropped",
            previewText: `${product.name} is now ₦${Number(product.price).toLocaleString()}.`,
            bodyHtml: `<p><strong>${escapeHtml(product.name)}</strong> is now <strong>₦${Number(product.price).toLocaleString()}</strong>.</p>`,
            ctaText: "View product",
            ctaUrl: `${env.appUrl}/products/${product.slug}`,
          }),
          event: "product_price_drop",
        });
        delivered = true;
      } catch {}
    }
    if (alert.whatsapp) {
      try {
        const result = await sendWhatsAppNotification({
          to: alert.whatsapp,
          message: `Price drop! ${product.name} is now ₦${Number(product.price).toLocaleString()} on TTFL Store. ${env.appUrl}/products/${product.slug}`,
          event: "product_price_drop",
        });
        delivered = delivered || Boolean(result.delivered);
      } catch {}
    }
    if (delivered) {
      await prisma.productAlert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
    }
  }
}

export async function processProductAlerts() {
  if (running) return;
  running = true;
  try {
    await processBackInStock();
    await processPriceDrops();
  } finally {
    running = false;
  }
}

export function startProductAlertWorker() {
  void processProductAlerts().catch((error) => {
    console.error("Product alert worker failed:", error);
  });

  const timer = setInterval(() => {
    void processProductAlerts().catch((error) => {
      console.error("Product alert worker failed:", error);
    });
  }, 60000);
  timer.unref();
}
