import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { getWhatsAppAdminNumbers } from "@/modules/settings/settings.service";

export async function sendWhatsAppNotification(params: { to: string; message: string; event: string }) {
  let recipients = [params.to].filter(Boolean);
  if (params.to === "__DATABASE_ADMIN_NUMBERS__") recipients = await getWhatsAppAdminNumbers();
  if (!recipients.length) return { ok: true as const, delivered: false };

  let delivered = false;
  for (const recipient of recipients) {
    const to = recipient.replace(/\D/g, "");
    if (!to) continue;
    try {
      if (env.whatsapp.botpressWebhookUrl) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (env.whatsapp.botpressWebhookSecret) headers["x-bp-secret"] = env.whatsapp.botpressWebhookSecret;
        const response = await fetch(env.whatsapp.botpressWebhookUrl, { method: "POST", headers, body: JSON.stringify({ userPhone: `+${to}`, message: params.message, event: params.event }) });
        if (response.ok) { delivered = true; continue; }
        logger.error(`Botpress WhatsApp delivery failed: ${response.status} ${await response.text()}`);
      }
      if (env.whatsapp.apiToken && env.whatsapp.phoneNumberId) {
        const response = await fetch(`https://graph.facebook.com/v19.0/${env.whatsapp.phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${env.whatsapp.apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: params.message } }) });
        if (!response.ok) logger.error(`WhatsApp delivery failed: ${response.status} ${await response.text()}`); else delivered = true;
      }
    } catch (err) { logger.error("WhatsApp delivery threw", { err, recipient: to, event: params.event }); }
  }
  return { ok: delivered as boolean, delivered };
}

export function newOrderWhatsAppMessage(orderNumber: string, amount: number) { return `New TTFL Store order ${orderNumber} — ₦${amount.toLocaleString()}. Check your dashboard to fulfill it.`; }
export function newVendorApplicationWhatsAppMessage(storeName: string) { return `New vendor application on TTFL Store: ${storeName}. Review it in the admin dashboard.`; }
export function paymentAlertWhatsAppMessage(orderNumber: string) { return `Payment failed for order ${orderNumber} on TTFL Store.`; }
export function customerOrderWhatsAppMessage(orderNumber: string, amount: number) { return `TTFL Store: Payment confirmed for order ${orderNumber}. Your order is now being processed. Total: ₦${amount.toLocaleString()}.`;
}
