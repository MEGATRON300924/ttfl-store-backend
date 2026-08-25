import { env } from "@/config/env";
import { logger } from "@/lib/logger";

/**
 * Architecture-only in this pass: the actual "customer clicks WhatsApp
 * button" flow (spec §14/§15, products.service.recordReferralAndGetDestination)
 * needs NO API — it just opens a wa.me link, and that already works.
 *
 * What's missing and what THIS file provides the shape for is ADMIN/VENDOR
 * notifications — "you have a new order" pushed to a store owner's phone
 * via the WhatsApp Business API, which needs a real Meta/WhatsApp Business
 * account and a message-template approval process this project doesn't
 * have credentials for yet. Until WHATSAPP_API_TOKEN is set, this adapter
 * just logs — same honest "console" pattern as the email adapter before a
 * provider is wired in.
 */
export async function sendWhatsAppNotification(params: { to: string; message: string; event: string }) {
  const token = env.whatsapp.apiToken;
  const phoneNumberId = env.whatsapp.phoneNumberId;

  if (!token || !phoneNumberId) {
    logger.info(`[whatsapp:stub] to=${params.to} event=${params.event} message="${params.message}"`);
    return { ok: true as const, delivered: false };
  }

  // Meta WhatsApp Business Cloud API shape — https://developers.facebook.com/docs/whatsapp/cloud-api
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to.replace(/\D/g, ""),
        type: "text",
        text: { body: params.message },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error(`WhatsApp delivery failed: ${res.status} ${body}`);
      return { ok: false as const, delivered: false };
    }
    return { ok: true as const, delivered: true };
  } catch (err) {
    logger.error("WhatsApp delivery threw", { err });
    return { ok: false as const, delivered: false };
  }
}

export function newOrderWhatsAppMessage(orderNumber: string, amount: number) {
  return `New TTFL Store order ${orderNumber} — ₦${amount.toLocaleString()}. Check your dashboard to fulfill it.`;
}

export function newVendorApplicationWhatsAppMessage(storeName: string) {
  return `New vendor application on TTFL Store: ${storeName}. Review it in the admin dashboard.`;
}

export function paymentAlertWhatsAppMessage(orderNumber: string) {
  return `Payment failed for order ${orderNumber} on TTFL Store.`;
}
