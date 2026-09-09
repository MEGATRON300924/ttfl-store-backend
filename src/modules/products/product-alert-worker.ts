import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { sendEmail } from "@/lib/email";
import { renderEmailLayout, escapeHtml } from "@/lib/email-layout";
import { sendWhatsAppNotification } from "@/lib/whatsapp-notifications";

let running = false;

async function processBackInStock() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; slug: string; email: string | null; whatsapp: string | null }>>(`
    SELECT a.id,p.name,p.slug,a.email,a.whatsapp
    FROM product_alerts a
    JOIN products p ON p.id=a.product_id
    WHERE a.type='BACK_IN_STOCK'
      AND a.notified_at IS NULL
      AND p."deletedAt" IS NULL
      AND p.status='ACTIVE'
      AND p.stock > 0
    LIMIT 100
  `);

  for (const row of rows) {
    let delivered = false;
    if (row.email) {
      try {
        await sendEmail({
          to: row.email,
          subject: `${row.name} is back in stock`,
          html: renderEmailLayout({
            heading: "Back in stock",
            previewText: `${row.name} is available again.`,
            bodyHtml: `<p><strong>${escapeHtml(row.name)}</strong> is back in stock on TTFL Store.</p>`,
            ctaText: "Shop now",
            ctaUrl: `${env.appUrl}/products/${row.slug}`,
          }),
          event: "product_back_in_stock",
        });
        delivered = true;
      } catch {}
    }
    if (row.whatsapp) {
      try {
        const result = await sendWhatsAppNotification({
          to: row.whatsapp,
          message: `${row.name} is back in stock on TTFL Store. ${env.appUrl}/products/${row.slug}`,
          event: "product_back_in_stock",
        });
        delivered = delivered || Boolean(result.delivered);
      } catch {}
    }
    if (delivered) {
      await prisma.$executeRawUnsafe(`UPDATE product_alerts SET notified_at=NOW() WHERE id=$1`, row.id);
    }
  }
}

async function processPriceDrops() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; slug: string; email: string | null; whatsapp: string | null; targetPrice: number; newPrice: number }>>(`
    SELECT a.id,p.name,p.slug,a.email,a.whatsapp,a.target_price AS "targetPrice",p.price AS "newPrice"
    FROM product_alerts a
    JOIN products p ON p.id=a.product_id
    WHERE a.type='PRICE_DROP'
      AND a.notified_at IS NULL
      AND p."deletedAt" IS NULL
      AND p.status='ACTIVE'
      AND a.target_price IS NOT NULL
      AND p.price <= a.target_price
    LIMIT 100
  `);

  for (const row of rows) {
    let delivered = false;
    if (row.email) {
      try {
        await sendEmail({
          to: row.email,
          subject: `Price drop: ${row.name}`,
          html: renderEmailLayout({
            heading: "Price dropped",
            previewText: `${row.name} is now ₦${Number(row.newPrice).toLocaleString()}.`,
            bodyHtml: `<p><strong>${escapeHtml(row.name)}</strong> is now <strong>₦${Number(row.newPrice).toLocaleString()}</strong>.</p>`,
            ctaText: "View product",
            ctaUrl: `${env.appUrl}/products/${row.slug}`,
          }),
          event: "product_price_drop",
        });
        delivered = true;
      } catch {}
    }
    if (row.whatsapp) {
      try {
        const result = await sendWhatsAppNotification({
          to: row.whatsapp,
          message: `Price drop! ${row.name} is now ₦${Number(row.newPrice).toLocaleString()} on TTFL Store. ${env.appUrl}/products/${row.slug}`,
          event: "product_price_drop",
        });
        delivered = delivered || Boolean(result.delivered);
      } catch {}
    }
    if (delivered) {
      await prisma.$executeRawUnsafe(`UPDATE product_alerts SET notified_at=NOW() WHERE id=$1`, row.id);
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
  void processProductAlerts();
  const timer = setInterval(() => void processProductAlerts(), 60000);
  timer.unref();
}
