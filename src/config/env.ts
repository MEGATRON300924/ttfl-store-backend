import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const production = process.env.NODE_ENV === "production";
const defaultCorsOrigin = production ? "https://www.ttflstore.name.ng" : "http://localhost:3000";
const corsOrigins = (process.env.CORS_ORIGIN ?? defaultCorsOrigin)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: production,
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? (production ? "https://www.ttflstore.name.ng" : "http://localhost:3000"),
  databaseUrl: required("DATABASE_URL"),
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "1d",
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
  cookies: {
    crossSite: process.env.COOKIE_CROSS_SITE === "true",
  },
  corsOrigin: corsOrigins[0] ?? defaultCorsOrigin,
  corsOrigins,
  email: {
    from: process.env.EMAIL_FROM ?? "TTFL Store no-reply@thetronforge.com",
    provider: process.env.EMAIL_PROVIDER ?? "console",
  },
  adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL,
  maxAi: {
    eventWebhookUrl: process.env.MAX_AI_EVENT_WEBHOOK_URL,
    eventWebhookSecret: process.env.MAX_AI_EVENT_WEBHOOK_SECRET,
  },
  whatsapp: {
    apiToken: process.env.WHATSAPP_API_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    adminNumber: process.env.WHATSAPP_ADMIN_NUMBER ?? "__DATABASE_ADMIN_NUMBERS__",
    botpressWebhookUrl: process.env.BOTPRESS_WHATSAPP_WEBHOOK_URL,
    botpressWebhookSecret: process.env.BOTPRESS_WHATSAPP_WEBHOOK_SECRET,
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en_US",
    trackingLinkTtlDays: Number(process.env.WHATSAPP_TRACKING_LINK_TTL_DAYS ?? 90),
    templates: {
      orderConfirmation: process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRMATION ?? "ttfl_order_confirmation",
      adminNewOrder: process.env.WHATSAPP_TEMPLATE_ADMIN_NEW_ORDER ?? "ttfl_admin_order_alert",
      vendorApplication: process.env.WHATSAPP_TEMPLATE_VENDOR_APPLICATION ?? "ttfl_vendor_application",
      paymentAlert: process.env.WHATSAPP_TEMPLATE_PAYMENT_ALERT ?? "ttfl_payment_alert",
      genericNotification: process.env.WHATSAPP_TEMPLATE_GENERIC_NOTIFICATION ?? "ttfl_notification",
      orderProcessing: process.env.WHATSAPP_TEMPLATE_ORDER_PROCESSING ?? "ttfl_order_processing",
      orderShipped: process.env.WHATSAPP_TEMPLATE_ORDER_SHIPPED ?? "ttfl_order_shipped",
      orderOutForDelivery: process.env.WHATSAPP_TEMPLATE_ORDER_OUT_FOR_DELIVERY ?? "ttfl_order_out_for_delivery",
      orderDelivered: process.env.WHATSAPP_TEMPLATE_ORDER_DELIVERED ?? "ttfl_order_delivered",
      orderCancelled: process.env.WHATSAPP_TEMPLATE_ORDER_CANCELLED ?? "ttfl_order_cancelled",
      productAvailable: process.env.WHATSAPP_TEMPLATE_PRODUCT_AVAILABLE ?? "ttfl_product_available",
      vendorStoreApproved: process.env.WHATSAPP_TEMPLATE_VENDOR_STORE_APPROVED ?? "ttfl_vendor_store_approved",
      vendorFirstProduct: process.env.WHATSAPP_TEMPLATE_VENDOR_FIRST_PRODUCT ?? "ttfl_vendor_first_product",
    },
  },
  authRateLimit: {
    max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    windowMin: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MIN ?? 15),
  },
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
};
