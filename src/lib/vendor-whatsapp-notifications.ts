import { sendWhatsAppTemplate, type WhatsAppSendResult } from "@/lib/whatsapp-notifications";

export function vendorStoreApprovedWhatsAppMessage(phone: string, storeName: string): Promise<WhatsAppSendResult> {
  return sendWhatsAppTemplate({
    to: phone,
    templateName: "ttfl_vendor_store_approved",
    bodyParameters: [storeName],
    event: "vendor_store_approved",
  });
}

export function vendorFirstProductWhatsAppMessageTemplate(phone: string, productName: string, productSlug: string): Promise<WhatsAppSendResult> {
  return sendWhatsAppTemplate({
    to: phone,
    templateName: "ttfl_vendor_first_product",
    bodyParameters: [productName],
    buttonUrlParameters: [productSlug],
    event: "vendor_first_product",
  });
}
