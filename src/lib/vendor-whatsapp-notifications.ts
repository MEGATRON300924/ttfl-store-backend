import { env } from "@/config/env";
import { sendWhatsAppTemplate, type WhatsAppSendResult } from "@/lib/whatsapp-notifications";

export function vendorStoreApprovedWhatsAppMessage(phone: string, storeName: string): Promise<WhatsAppSendResult> {
  return sendWhatsAppTemplate({
    to: phone,
    templateName: env.whatsapp.templates.vendorStoreApproved,
    bodyParameters: [storeName],
    event: "vendor_store_approved",
  });
}

export function vendorFirstProductWhatsAppMessageTemplate(phone: string, productName: string, productSlug: string): Promise<WhatsAppSendResult> {
  return sendWhatsAppTemplate({
    to: phone,
    templateName: env.whatsapp.templates.vendorFirstProduct,
    bodyParameters: [productName],
    buttonUrlParameters: [productSlug],
    event: "vendor_first_product",
  });
}
