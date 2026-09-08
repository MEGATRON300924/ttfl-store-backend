import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { getWhatsAppAdminNumbers } from "@/modules/settings/settings.service";

export type WhatsAppSendResult = {
  ok: boolean;
  delivered: boolean;
  status?: number;
  messageId?: string;
  error?: string;
};

function maskRecipient(to: string) {
  return to.replace(/^(\d{3})\d+(\d{3})$/, "$1******$2");
}

async function sendMetaWhatsAppText(to: string, message: string): Promise<WhatsAppSendResult> {
  if (!env.whatsapp.apiToken || !env.whatsapp.phoneNumberId) {
    return { ok: false, delivered: false, error: "WhatsApp API token or phone number ID is not configured." };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${env.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsapp.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });

    const body = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch {}

    if (!response.ok) {
      const error = parsed?.error?.message || body || `Meta WhatsApp API returned ${response.status}`;
      logger.error(`WhatsApp delivery failed: ${response.status} ${error}`, { code: parsed?.error?.code, recipient: maskRecipient(to) });
      return { ok: false, delivered: false, status: response.status, error };
    }

    const messageId = parsed?.messages?.[0]?.id;
    logger.info("MAX AI WhatsApp message accepted by Meta", {
      recipient: maskRecipient(to),
      status: response.status,
      messageId,
      type: "text",
    });

    return { ok: true, delivered: true, status: response.status, messageId };
  } catch (err) {
    logger.error("WhatsApp delivery threw", { err, recipient: maskRecipient(to) });
    return { ok: false, delivered: false, error: err instanceof Error ? err.message : "WhatsApp request failed" };
  }
}

export async function sendWhatsAppTemplate(params: {
  to: string;
  templateName: string;
  bodyParameters?: string[];
  languageCode?: string;
  event: string;
}): Promise<WhatsAppSendResult> {
  if (!env.whatsapp.apiToken || !env.whatsapp.phoneNumberId) {
    return { ok: false, delivered: false, error: "WhatsApp API token or phone number ID is not configured." };
  }

  const to = params.to.replace(/\D/g, "");
  if (!to) return { ok: false, delivered: false, error: "Invalid WhatsApp recipient number." };

  try {
    const components = params.bodyParameters?.length
      ? [{
          type: "body",
          parameters: params.bodyParameters.map(text => ({ type: "text", text: String(text).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim() })),
        }]
      : undefined;

    const response = await fetch(`https://graph.facebook.com/v19.0/${env.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsapp.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode ?? env.whatsapp.templateLanguage },
          ...(components ? { components } : {}),
        },
      }),
    });

    const body = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch {}

    if (!response.ok) {
      const error = parsed?.error?.message || body || `Meta WhatsApp API returned ${response.status}`;
      logger.error(`WhatsApp template delivery failed: ${response.status} ${error}`, {
        code: parsed?.error?.code,
        recipient: maskRecipient(to),
        template: params.templateName,
        event: params.event,
      });
      return { ok: false, delivered: false, status: response.status, error };
    }

    const messageId = parsed?.messages?.[0]?.id;
    logger.info("MAX AI WhatsApp template accepted by Meta", {
      recipient: maskRecipient(to),
      status: response.status,
      messageId,
      template: params.templateName,
      event: params.event,
    });

    return { ok: true, delivered: true, status: response.status, messageId };
  } catch (err) {
    logger.error("WhatsApp template delivery threw", {
      err,
      recipient: maskRecipient(to),
      template: params.templateName,
      event: params.event,
    });
    return { ok: false, delivered: false, error: err instanceof Error ? err.message : "WhatsApp template request failed" };
  }
}

export async function sendWhatsAppNotification(params: { to: string; message: string; event: string }): Promise<WhatsAppSendResult> {
  let recipients = [params.to].filter(Boolean);
  if (params.to === "__DATABASE_ADMIN_NUMBERS__") recipients = await getWhatsAppAdminNumbers();
  if (!recipients.length) return { ok: false, delivered: false, error: "No WhatsApp recipient numbers are configured." };

  let lastResult: WhatsAppSendResult = { ok: false, delivered: false };
  for (const recipient of recipients) {
    const to = recipient.replace(/\D/g, "");
    if (!to) continue;
    try {
      if (env.whatsapp.botpressWebhookUrl) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (env.whatsapp.botpressWebhookSecret) headers["x-bp-secret"] = env.whatsapp.botpressWebhookSecret;
        const response = await fetch(env.whatsapp.botpressWebhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ userPhone: `+${to}`, message: params.message, event: params.event }),
        });
        if (response.ok) {
          logger.info("MAX AI WhatsApp message accepted by Botpress", { recipient: maskRecipient(to), event: params.event });
          return { ok: true, delivered: true, status: response.status };
        }
        logger.error(`Botpress WhatsApp delivery failed: ${response.status} ${await response.text()}`);
      }
      lastResult = await sendMetaWhatsAppText(to, params.message);
      if (lastResult.delivered) return lastResult;
    } catch (err) {
      lastResult = { ok: false, delivered: false, error: err instanceof Error ? err.message : "WhatsApp request failed" };
      logger.error("WhatsApp delivery threw", { err, recipient: maskRecipient(to), event: params.event });
    }
  }

  return lastResult;
}

export async function sendWhatsAppTemplateToRecipients(params: {
  recipients: string[];
  templateName: string;
  bodyParameters?: string[];
  languageCode?: string;
  event: string;
}): Promise<WhatsAppSendResult> {
  const validRecipients = params.recipients.map(number => number.replace(/\D/g, "")).filter(Boolean);
  if (!validRecipients.length) return { ok: false, delivered: false, error: "No WhatsApp recipient numbers are configured." };

  let firstFailure: WhatsAppSendResult | null = null;
  for (const to of validRecipients) {
    const result = await sendWhatsAppTemplate({
      to,
      templateName: params.templateName,
      bodyParameters: params.bodyParameters,
      languageCode: params.languageCode,
      event: params.event,
    });
    if (result.delivered) return result;
    firstFailure ??= result;
  }

  return firstFailure ?? { ok: false, delivered: false, error: "WhatsApp template delivery failed." };
}

export async function testWhatsAppForAdmins(message: string): Promise<WhatsAppSendResult> {
  const recipients = await getWhatsAppAdminNumbers();
  if (!recipients.length) return { ok: false, delivered: false, error: "No WhatsApp admin numbers are configured." };

  const results = await Promise.all(recipients.map(async recipient => {
    const to = recipient.replace(/\D/g, "");
    return to ? sendMetaWhatsAppText(to, message) : { ok: false, delivered: false, error: "Invalid admin phone number." };
  }));

  const successful = results.find(result => result.delivered);
  if (successful) return successful;
  return results[0] ?? { ok: false, delivered: false, error: "WhatsApp test failed." };
}

export function newOrderWhatsAppMessage(orderNumber: string, amount: number) {
  return `🔔 New TTFL Store order\n\nOrder: ${orderNumber}\nAmount: ₦${amount.toLocaleString()}\n\nPlease check your TTFL Store admin dashboard to review and fulfill the order.\n\n— Max AI`;
}

export function newVendorApplicationWhatsAppMessage(storeName: string) {
  return `🏪 New vendor application\n\nStore: ${storeName}\n\nA new vendor has applied to sell on TTFL Store. Please review the application in your admin dashboard.\n\n— Max AI`;
}

export function paymentAlertWhatsAppMessage(orderNumber: string) {
  return `⚠️ Payment alert\n\nPayment failed for TTFL Store order ${orderNumber}.\n\nPlease review the order and payment status in your admin dashboard.\n\n— Max AI`;
}

export function customerOrderWhatsAppMessage(orderNumber: string, amount: number) {
  return `Hey! 👋 Your order is confirmed\n\nYour TTFL Store order ${orderNumber} has been successfully paid for and is now being processed.\n\nTotal: ₦${amount.toLocaleString()}\n\nIf you need help with your order, just reply here and Max AI will assist you.\n\n— Max AI`;
}
